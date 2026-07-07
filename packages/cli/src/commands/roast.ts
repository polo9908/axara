/**
 * `axaraaudit roast` — the audit, delivered by a stand-up comedian. 😈
 *
 * Runs the full audit (drift + RGAA), then asks Claude for a short, biting
 * but kind-hearted roast of the findings, ending with the top 3 fixes.
 * Same opt-in key as `fix --ai`; pure fun, zero write access.
 */

import { readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  auditSources,
  auditHtmlRgaa,
  jsxToHtml,
  PAGE_SCOPED_RULES,
  type SourceFile,
} from '@axaraaudit/core';
import { loadRc } from '../config/rc.js';
import { loadTokensSource } from '../config/tokens-source.js';
import { resolveAnthropicKey } from '../config/credentials.js';
import { requestText, ClaudeError } from '../services/claude.js';
import { collectFiles } from '../scan/walk.js';
import { printTips } from '../ui/tips.js';
import { computeScore, type FileRgaaFinding } from '../report/score.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';

const JSX_EXT = new Set(['.tsx', '.jsx']);
const HTML_EXT = new Set(['.html', '.htm']);

const ROAST_SYSTEM = `Tu es un humoriste tech français, expert en accessibilité web et design systems.
On te donne les résultats d'audit d'un projet. Écris un "roast" : cinglant, drôle, précis — mais JAMAIS méprisant ni humiliant. On rit du code, pas du développeur.

Contraintes :
- 120 à 200 mots, en français.
- Appuie-toi sur les problèmes RÉELS listés (cite-en 2 ou 3, avec leur détail savoureux).
- Une pointe d'empathie : tout le monde a déjà fait ça.
- Termine par exactement ce format :
  🔧 Le plan de rachat :
  1. <action concrète>
  2. <action concrète>
  3. <action concrète>
  suivi d'UNE phrase d'encouragement sincère.
- Pas de bloc de code, pas de markdown de titre, juste du texte.`;

export async function runRoast(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      tokens: { type: 'string' },
      model: { type: 'string' },
    },
    allowPositionals: true,
  });

  const apiKey = resolveAnthropicKey();
  if (apiKey === null) {
    process.stdout.write(`\n${yellow('  ✦ Le roast a besoin d’une clé Anthropic.')}\n`);
    process.stdout.write(`    1. Créez une clé sur ${cyan('https://console.anthropic.com/settings/keys')}\n`);
    process.stdout.write(`    2. ${bold('axaraaudit login --anthropic-key sk-ant-...')}\n\n`);
    return 2;
  }

  const cwd = process.cwd();
  const loaded = loadRc(cwd, values.config);
  const filePaths = collectFiles(loaded.rootDir, loaded.rc.include, loaded.rc.exclude, loaded.rc.extensions);
  const files: SourceFile[] = filePaths.map((path) => ({ path, content: readFileSync(path, 'utf8') }));
  const tokensSource = loadTokensSource(loaded, values.tokens, files);

  process.stdout.write(dim('\n  Audit en cours… le comédien prépare ses notes. 🎤\n'));

  const drift = auditSources(tokensSource.json, files, { remBasePx: loaded.rc.remBasePx });
  const rgaaFindings: FileRgaaFinding[] = [];
  if (loaded.rc.rgaa.enabled) {
    for (const file of files) {
      const ext = extname(file.path).toLowerCase();
      let html: string | null = null;
      if (JSX_EXT.has(ext)) html = jsxToHtml(file.content);
      else if (HTML_EXT.has(ext)) html = file.content;
      if (html === null || html.trim() === '') continue;
      const report = await auditHtmlRgaa(html, {
        contrast: loaded.rc.rgaa.contrast,
        ...(loaded.rc.rgaa.scope === 'component' ? { disableRules: PAGE_SCOPED_RULES } : {}),
      });
      for (const finding of report.findings) {
        rgaaFindings.push({ file: relative(loaded.rootDir, file.path), finding });
      }
    }
  }
  const score = computeScore(drift.summary, rgaaFindings);

  if (drift.issues.length === 0 && rgaaFindings.length === 0) {
    process.stdout.write(green(`\n  Score ${score}/100 — rien à roaster. Le comédien rentre chez lui, vexé. 👏\n\n`));
    return 0;
  }

  // Feed the comedian the juiciest material (bounded).
  const material: string[] = [];
  for (const { file, finding } of rgaaFindings.slice(0, 12)) {
    material.push(
      `RGAA ${finding.criterion} (${finding.impact ?? '?'}) dans ${file} : ${finding.criterionTitle} — élément ${finding.occurrences[0]?.html.slice(0, 120) ?? ''}`,
    );
  }
  for (const issue of drift.issues.slice(0, 12)) {
    material.push(
      `Design drift dans ${relative(loaded.rootDir, issue.file)}:L${issue.line} : ${issue.property}: ${issue.value}${issue.suggestion !== undefined ? ` (le token ${issue.suggestion.token} existe pourtant…)` : ' (aucun token ne correspond)'}`,
    );
  }

  const user = [
    `Projet : ${loaded.rc.project}`,
    `Score de conformité : ${score}/100`,
    `Dérives design : ${drift.summary.totalIssues} · Non-conformités RGAA : ${rgaaFindings.length}`,
    '',
    'Problèmes relevés :',
    ...material.map((m) => `- ${m}`),
  ].join('\n');

  try {
    const result = await requestText(apiKey, {
      system: ROAST_SYSTEM,
      user,
      maxTokens: 2000,
      ...(values.model !== undefined ? { model: values.model } : {}),
    });

    process.stdout.write(`\n${bold('  🎤 LE ROAST')} ${dim(`(${result.model})`)}\n\n`);
    for (const line of result.text.trim().split('\n')) {
      process.stdout.write(`  ${line}\n`);
    }
    const scoreColor = score >= 80 ? green : score >= 60 ? yellow : red;
    process.stdout.write(`\n  ${bold('SCORE')}  ${scoreColor(bold(`${score}/100`))}`);
    process.stdout.write(dim(`   · ${result.inputTokens + result.outputTokens} tokens API\n\n`));
    if (score < 100) {
      printTips([
        { cmd: 'axaraaudit fix --ai --write', why: 'faites taire l\'humoriste : corrigez tout' },
        { cmd: 'axaraaudit roast', why: 're-roast après corrections — il sera plus gentil' },
      ]);
    }
    return 0;
  } catch (error) {
    if (error instanceof ClaudeError) {
      process.stderr.write(red(`\n  ✗ ${error.message}\n\n`));
      return 2;
    }
    throw error;
  }
}
