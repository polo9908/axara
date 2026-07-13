/**
 * `axaraaudit fix-all` — tout corriger en une commande, depuis la palette.
 *
 * Enchaîne les trois passes de `fix` sans retaper les flags :
 *   1. mécanique (tokens exacts + tokens proches, confiance ≥ 0.7) ;
 *   2. IA (RGAA : alt, labels, titres, tabulation… + valeurs sans token).
 *
 * Sur TTY, le modèle IA est choisi interactivement (↑↓ + Entrée), puis la
 * correction s'exécute avec un compteur de progression x/N animé. Les
 * fichiers SONT modifiés (c'est le contrat de la commande) et leur contenu
 * est envoyé à l'API Anthropic — la clé configurée vaut opt-in.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  auditHtmlRgaa,
  fixProject,
  jsxToHtml,
  PAGE_SCOPED_RULES,
} from '@axaraaudit/core';
import { ConfigError } from '../config/rc.js';
import { resolveAnthropicKey } from '../config/credentials.js';
import { requestFileFix, ClaudeError, CLAUDE_MODEL } from '../services/claude.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';
import { tr } from '../i18n.js';
import { createSpinner } from '../ui/spinner.js';
import { canSelect, selectOption, type SelectChoice } from '../ui/select.js';
import { printTips, type Tip } from '../ui/tips.js';
import {
  describeDriftIssue,
  describeRgaaFinding,
  tokensCatalog,
  HTML_EXT,
  JSX_EXT,
} from './fix.js';

/** Modèles proposés par le sélecteur — le défaut de `fix --ai` en premier. */
export const MODEL_CHOICES: readonly SelectChoice[] = [
  {
    value: CLAUDE_MODEL,
    label: CLAUDE_MODEL,
    detail: tr('le plus précis — recommandé', 'most accurate — recommended'),
  },
  {
    value: 'claude-sonnet-5',
    label: 'claude-sonnet-5',
    detail: tr('équilibre vitesse / qualité', 'speed / quality balance'),
  },
  {
    value: 'claude-haiku-4-5-20251001',
    label: 'claude-haiku-4-5-20251001',
    detail: tr('le plus rapide et économique', 'fastest and cheapest'),
  },
];

/** Libellé du compteur de progression — pur, testable. */
export function progressLabel(done: number, total: number, current?: string): string {
  const counter = tr(
    `${done}/${total} erreur(s) corrigée(s)`,
    `${done}/${total} error(s) fixed`,
  );
  return current === undefined ? counter : `${counter} · ${current}`;
}

function out(text: string): void {
  process.stdout.write(text);
}

export async function runFixAll(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      tokens: { type: 'string' },
      model: { type: 'string' },
      'min-confidence': { type: 'string' },
    },
    allowPositionals: true,
  });

  const rawConfidence = values['min-confidence'];
  const minConfidence = rawConfidence === undefined ? 0.7 : Number(rawConfidence);
  if (Number.isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new ConfigError(
      tr(
        `--min-confidence doit être un nombre entre 0 et 1 (reçu: ${rawConfidence}).`,
        `--min-confidence must be a number between 0 and 1 (got: ${rawConfidence}).`,
      ),
    );
  }

  // ── 0. Clé IA obligatoire : fix-all inclut toujours la passe IA ──
  const apiKey = resolveAnthropicKey();
  if (apiKey === null) {
    out(`${yellow(tr('  ✦ Correction IA non configurée.', '  ✦ AI fixing is not configured.'))}\n`);
    out(tr("  fix-all a besoin d'une clé Anthropic (2 minutes) :\n", '  fix-all needs an Anthropic key (2 minutes):\n'));
    out(
      tr(
        `    1. Créez une clé API sur ${cyan('https://console.anthropic.com/settings/keys')}\n`,
        `    1. Create an API key at ${cyan('https://console.anthropic.com/settings/keys')}\n`,
      ),
    );
    out(`    2. ${bold('axaraaudit login --anthropic-key sk-ant-...')}\n`);
    out(
      dim(
        tr(
          "       (ou définissez la variable d'environnement ANTHROPIC_API_KEY)\n",
          '       (or set the ANTHROPIC_API_KEY environment variable)\n',
        ),
      ),
    );
    return 2;
  }

  // ── 1. Choix du modèle : flag > sélecteur interactif > défaut ──
  let model = values.model;
  if (model === undefined && canSelect()) {
    out('\n');
    const pick = await selectOption(
      tr('Quel modèle pour la passe IA ?', 'Which model for the AI pass?'),
      MODEL_CHOICES,
    );
    if (pick === null) {
      out(dim(tr('  Annulé — aucun fichier modifié.\n', '  Cancelled — no file modified.\n')));
      return 0;
    }
    model = pick;
  }
  model ??= CLAUDE_MODEL;

  const projectOpts = {
    cwd: process.cwd(),
    ...(values.config !== undefined ? { configPath: values.config } : {}),
    ...(values.tokens !== undefined ? { tokensPath: values.tokens } : {}),
    all: true,
    minConfidence,
  };

  // ── 2. Recensement (dry-run) : combien d'erreurs au total ? ──
  const preview = fixProject({ ...projectOpts, write: false });
  const { loaded, report, files: filePaths, remaining } = preview;
  const rel = (path: string): string => relative(loaded.rootDir, path);

  if (preview.tokensSource.origin === 'auto') {
    process.stderr.write(
      green(tr(`✓ Zéro-config : ${preview.tokensSource.detail}.\n`, `✓ Zero-config: ${preview.tokensSource.detail}.\n`)),
    );
  }

  // Problèmes pour l'IA : dérives sans correction mécanique + RGAA par fichier.
  const aiWork = new Map<string, string[]>();
  for (const issue of remaining) {
    const list = aiWork.get(issue.file) ?? [];
    list.push(describeDriftIssue(issue));
    aiWork.set(issue.file, list);
  }
  if (loaded.rc.rgaa.enabled) {
    for (const path of filePaths) {
      const ext = extname(path).toLowerCase();
      const content = readFileSync(path, 'utf8');
      let html: string | null = null;
      if (JSX_EXT.has(ext)) html = jsxToHtml(content);
      else if (HTML_EXT.has(ext)) html = content;
      if (html === null || html.trim() === '') continue;
      const rgaa = await auditHtmlRgaa(html, {
        contrast: loaded.rc.rgaa.contrast,
        ...(loaded.rc.rgaa.scope === 'component' ? { disableRules: PAGE_SCOPED_RULES } : {}),
      });
      if (rgaa.findings.length === 0) continue;
      const list = aiWork.get(path) ?? [];
      for (const finding of rgaa.findings) list.push(describeRgaaFinding(finding));
      aiWork.set(path, list);
    }
  }

  const aiTotal = [...aiWork.values()].reduce((sum, issues) => sum + issues.length, 0);
  const total = preview.totalApplied + aiTotal;

  if (total === 0) {
    out(green(tr('  ✓ Rien à corriger : le projet est déjà conforme.\n', '  ✓ Nothing to fix: the project is already compliant.\n')));
    return 0;
  }

  out(
    `\n${bold(tr('  FIX-ALL — design system + RGAA + tabulation', '  FIX-ALL — design system + RGAA + keyboard'))} ${dim(`(${model})`)}\n`,
  );
  out(
    dim(
      tr(
        `  ${total} erreur(s) à corriger — ${preview.totalApplied} mécanique(s), ${aiTotal} via IA (${aiWork.size} fichier(s) envoyés à l'API Anthropic).\n\n`,
        `  ${total} error(s) to fix — ${preview.totalApplied} mechanical, ${aiTotal} via AI (${aiWork.size} file(s) sent to the Anthropic API).\n\n`,
      ),
    ),
  );

  const spinner = createSpinner(progressLabel(0, total));
  spinner.start();
  let done = 0;

  // ── 3. Passe mécanique (écriture directe) ──
  const written = fixProject({ ...projectOpts, write: true });
  done += written.totalApplied;
  spinner.update(progressLabel(done, total));

  // ── 4. Passe IA, fichier par fichier — le compteur avance à chaque succès ──
  let aiFixedFiles = 0;
  let aiInputTokens = 0;
  let aiOutputTokens = 0;
  const failures: string[] = [];
  for (const [path, issues] of aiWork) {
    spinner.update(progressLabel(done, total, cyan(rel(path))));
    // Relecture : la passe mécanique vient peut-être de réécrire le fichier.
    const source = readFileSync(path, 'utf8');
    try {
      const result = await requestFileFix(
        apiKey,
        { file: rel(path), source, issues, tokensCatalog: tokensCatalog(report.tokens) },
        { model },
      );
      aiInputTokens += result.inputTokens;
      aiOutputTokens += result.outputTokens;
      if (result.content.trimEnd() !== source.trimEnd()) {
        const endsWithNewline = source.endsWith('\n');
        writeFileSync(
          path,
          endsWithNewline && !result.content.endsWith('\n') ? `${result.content}\n` : result.content,
          'utf8',
        );
        aiFixedFiles += 1;
      }
      done += issues.length;
      spinner.update(progressLabel(done, total));
    } catch (error) {
      if (error instanceof ClaudeError) {
        failures.push(`${rel(path)} — ${error.message}`);
        if (error.status === 401) {
          spinner.fail(progressLabel(done, total));
          out(red(`  ✗ ${error.message}\n`));
          return 2;
        }
      } else {
        spinner.fail(progressLabel(done, total));
        throw error;
      }
    }
  }

  if (failures.length === 0) spinner.succeed(progressLabel(done, total));
  else spinner.fail(progressLabel(done, total));

  // ── 5. Bilan ──
  out(
    `\n  ${green(String(written.totalApplied))} ${tr('correction(s) mécanique(s) écrite(s)', 'mechanical fix(es) written')}, ${green(String(aiFixedFiles))} ${tr('fichier(s) corrigé(s) par IA', 'file(s) fixed by AI')}\n`,
  );
  if (aiWork.size > 0) {
    out(
      dim(
        tr(
          `  Utilisation API : ${aiInputTokens} tokens d'entrée, ${aiOutputTokens} tokens de sortie.\n`,
          `  API usage: ${aiInputTokens} input tokens, ${aiOutputTokens} output tokens.\n`,
        ),
      ),
    );
  }
  for (const failure of failures) out(red(`  ✗ ${failure}\n`));

  const tips: Tip[] = [
    {
      cmd: 'axaraaudit audit',
      why: tr('mesurez le nouveau score après corrections', 'measure the new score after the fixes'),
    },
  ];
  printTips(tips);
  return failures.length > 0 ? 1 : 0;
}
