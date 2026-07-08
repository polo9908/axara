/**
 * `axaraaudit fix` — apply the fixes found by the analyzers.
 *
 * Three levels, from safest to most powerful:
 * - default : only exact-token matches (100% safe, position-verified);
 * - `--all` : also apply nearest-token suggestions (confidence ≥ --min-confidence);
 * - `--ai`  : send the remaining problems (RGAA + values without tokens) to
 *   Claude for a proposed correction. Explicit opt-in: file contents are sent
 *   to the Anthropic API; requires ANTHROPIC_API_KEY or
 *   `axaraaudit login --anthropic-key <clé>`.
 *
 * Dry-run by default; `--write` persists. The report is exhaustive: everything
 * NOT applied is listed with the reason, so the user knows what remains manual.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  auditHtmlRgaa,
  fixProject,
  jsxToHtml,
  PAGE_SCOPED_RULES,
  type DesignToken,
  type DriftIssue,
  type RgaaFinding,
} from '@axaraaudit/core';
import { ConfigError } from '../config/rc.js';
import { resolveAnthropicKey } from '../config/credentials.js';
import { requestFileFix, ClaudeError, CLAUDE_MODEL } from '../services/claude.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';
import { tr } from '../i18n.js';
import { printTips, type Tip } from '../ui/tips.js';

const JSX_EXT = new Set(['.tsx', '.jsx']);
const HTML_EXT = new Set(['.html', '.htm']);

function out(text: string): void {
  process.stdout.write(text);
}

/** Compact line-based diff preview (- before / + after), capped for readability. */
function renderLineDiff(before: string, after: string, maxLines = 24): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max && lines.length < maxLines; i += 1) {
    const oldLine = a[i];
    const newLine = b[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) lines.push(red(`    - ${oldLine.trimEnd()}`));
    if (newLine !== undefined) lines.push(green(`    + ${newLine.trimEnd()}`));
  }
  if (lines.length >= maxLines) lines.push(dim(tr('    … (diff tronqué)', '    … (diff truncated)')));
  return lines.join('\n');
}

function describeDriftIssue(issue: DriftIssue): string {
  const suggestion =
    issue.suggestion !== undefined
      ? tr(
          ` ; token le plus proche : ${issue.suggestion.replacement} (${issue.suggestion.tokenValue})`,
          `; closest token: ${issue.suggestion.replacement} (${issue.suggestion.tokenValue})`,
        )
      : '';
  return tr(
    `Design drift L${issue.line} — ${issue.property}: ${issue.value} (aucun token exact${suggestion})`,
    `Design drift L${issue.line} — ${issue.property}: ${issue.value} (no exact token${suggestion})`,
  );
}

function describeRgaaFinding(finding: RgaaFinding): string {
  const impact = finding.impact ?? tr('impact inconnu', 'unknown impact');
  const sample = finding.occurrences[0]?.html.slice(0, 160) ?? '';
  return tr(
    `RGAA ${finding.criterion} — ${finding.criterionTitle} (${impact}). Élément : ${sample}`,
    `RGAA ${finding.criterion} — ${finding.criterionTitle} (${impact}). Element: ${sample}`,
  );
}

function tokensCatalog(tokens: readonly DesignToken[]): string {
  return tokens
    .filter((token) => token.category !== null)
    .map((token) => `${token.cssVar}: ${token.value}`)
    .join('\n');
}

export async function runFix(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      tokens: { type: 'string' },
      write: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      ai: { type: 'boolean', default: false },
      model: { type: 'string' },
      'min-confidence': { type: 'string' },
    },
    allowPositionals: true,
  });
  const write = values.write ?? false;
  const all = values.all ?? false;
  const ai = values.ai ?? false;

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

  // ── 1. Mechanical pass (exact tokens, plus near-misses with --all) ──
  // Shared pipeline in core: same collection, same tokens, same fixes as MCP.
  const mech = fixProject({
    cwd: process.cwd(),
    ...(values.config !== undefined ? { configPath: values.config } : {}),
    ...(values.tokens !== undefined ? { tokensPath: values.tokens } : {}),
    write,
    all,
    minConfidence,
  });
  const { loaded, report, files: filePaths, totalApplied, remaining } = mech;

  if (mech.tokensSource.origin === 'auto') {
    process.stderr.write(
      green(tr(`✓ Zéro-config : ${mech.tokensSource.detail}.\n`, `✓ Zero-config: ${mech.tokensSource.detail}.\n`)),
    );
  }

  const rel = (path: string): string => relative(loaded.rootDir, path);

  out(
    `\n${bold(
      write
        ? tr('  AUTO-FIX — ÉCRITURE', '  AUTO-FIX — WRITE')
        : tr('  AUTO-FIX — PRÉVISUALISATION (dry-run)', '  AUTO-FIX — PREVIEW (dry-run)'),
    )}`,
  );
  out(
    all
      ? dim(tr(`  (mode --all, confiance ≥ ${minConfidence})`, `  (--all mode, confidence ≥ ${minConfidence})`))
      : '',
  );
  out(ai ? dim(tr('  (+ passe IA)', '  (+ AI pass)')) : '');
  out('\n\n');

  for (const fileResult of mech.fixed) {
    out(`  ${cyan(rel(fileResult.path))}\n`);
    for (const fix of fileResult.applied) {
      out(`    ${green('✓')} ${dim(`L${fix.line}`)}  ${fix.from} → ${green(fix.to)}\n`);
    }
  }
  if (totalApplied === 0)
    out(dim(tr('  (aucune correction mécanique applicable)\n', '  (no mechanical fix applicable)\n')));

  // ── 2. Optional AI pass (RGAA + drifts the mechanics could not solve) ──
  let aiFixedFiles = 0;
  let aiInputTokens = 0;
  let aiOutputTokens = 0;
  if (ai) {
    const apiKey = resolveAnthropicKey();
    if (apiKey === null) {
      out('\n');
      out(`${yellow(tr('  ✦ Correction IA non configurée.', '  ✦ AI fixing is not configured.'))}\n`);
      out(tr('  Pour l\'activer (2 minutes) :\n', '  To enable it (2 minutes):\n'));
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
            '       (ou définissez la variable d\'environnement ANTHROPIC_API_KEY)\n',
            '       (or set the ANTHROPIC_API_KEY environment variable)\n',
          ),
        ),
      );
      return 2;
    }

    // Collect per-file problems: leftover drifts + RGAA findings.
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

    out(`\n${bold(tr('  PASSE IA', '  AI PASS'))} ${dim(`(${values.model ?? CLAUDE_MODEL})`)}\n`);
    if (aiWork.size === 0) {
      out(green(tr('    ✓ Rien à corriger par IA.\n', '    ✓ Nothing left for the AI to fix.\n')));
    } else {
      out(
        dim(
          tr(
            `  ${aiWork.size} fichier(s) envoyé(s) à l'API Anthropic (opt-in --ai).\n`,
            `  ${aiWork.size} file(s) sent to the Anthropic API (opt-in --ai).\n`,
          ),
        ),
      );
      const catalog = tokensCatalog(report.tokens);

      for (const [path, issues] of aiWork) {
        // Re-read: the mechanical pass may have just rewritten the file.
        const source = readFileSync(path, 'utf8');
        out(
          `\n  ${cyan(rel(path))} ${dim(tr(`(${issues.length} problème(s))`, `(${issues.length} issue(s))`))}\n`,
        );
        try {
          const result = await requestFileFix(
            apiKey,
            { file: rel(path), source, issues, tokensCatalog: catalog },
            values.model !== undefined ? { model: values.model } : {},
          );
          aiInputTokens += result.inputTokens;
          aiOutputTokens += result.outputTokens;

          if (result.content.trimEnd() === source.trimEnd()) {
            out(dim(tr('    (aucune modification proposée)\n', '    (no change proposed)\n')));
            continue;
          }
          out(`${renderLineDiff(source, result.content)}\n`);
          if (write) {
            const endsWithNewline = source.endsWith('\n');
            writeFileSync(
              path,
              endsWithNewline && !result.content.endsWith('\n')
                ? `${result.content}\n`
                : result.content,
              'utf8',
            );
            out(green(tr('    ✓ Fichier corrigé par IA\n', '    ✓ File fixed by AI\n')));
          }
          aiFixedFiles += 1;
        } catch (error) {
          if (error instanceof ClaudeError) {
            out(red(`    ✗ ${error.message}\n`));
            if (error.status === 401) return 2;
          } else {
            throw error;
          }
        }
      }
      out(
        dim(
          tr(
            `\n  Utilisation API : ${aiInputTokens} tokens d'entrée, ${aiOutputTokens} tokens de sortie.\n`,
            `\n  API usage: ${aiInputTokens} input tokens, ${aiOutputTokens} output tokens.\n`,
          ),
        ),
      );
    }
  }

  // ── 3. Exhaustive remainder (only meaningful without the AI pass) ──
  if (!ai && remaining.length > 0) {
    const nearMisses = remaining.filter((issue) => issue.match === 'nearest-token');
    const noToken = remaining.filter((issue) => issue.match === 'no-token');
    out(`\n${bold(tr('  NON CORRIGÉ', '  NOT FIXED'))} ${dim(`(${remaining.length})`)}\n`);
    if (nearMisses.length > 0) {
      out(
        yellow(
          tr(
            `  Valeurs proches d'un token — vérifiez puis relancez avec --all :\n`,
            `  Values close to a token — review then re-run with --all:\n`,
          ),
        ),
      );
      for (const issue of nearMisses) {
        const s = issue.suggestion;
        out(
          `    ${yellow('≈')} ${dim(`${rel(issue.file)}:L${issue.line}`)}  ${issue.value} → ${
            s !== undefined
              ? `${s.replacement} ${dim(tr(`(confiance ${s.confidence})`, `(confidence ${s.confidence})`))}`
              : ''
          }\n`,
        );
      }
    }
    if (noToken.length > 0) {
      out(
        red(
          tr(
            `  Aucun token proche — décision manuelle, ou déléguez à l'IA avec --ai :\n`,
            `  No close token — decide manually, or delegate to the AI with --ai:\n`,
          ),
        ),
      );
      for (const issue of noToken) {
        out(`    ${red('✖')} ${dim(`${rel(issue.file)}:L${issue.line}`)}  ${issue.property}: ${issue.value}\n`);
      }
    }
  }

  // ── Summary ──
  out(
    `\n  ${green(String(totalApplied))} ${
      write
        ? tr('correction(s) mécanique(s) appliquée(s)', 'mechanical fix(es) applied')
        : tr('correction(s) mécanique(s) applicable(s)', 'mechanical fix(es) applicable')
    }`,
  );
  if (ai)
    out(
      `, ${green(String(aiFixedFiles))} ${tr('fichier(s) corrigé(s) par IA', 'file(s) fixed by AI')}`,
    );
  else out(tr(`, ${String(remaining.length)} restante(s)`, `, ${String(remaining.length)} remaining`));
  out('\n');

  // ── Tips contextuels : la prochaine étape logique selon le résultat ──
  const tips: Tip[] = [];
  if (!write && (totalApplied > 0 || aiFixedFiles > 0)) {
    tips.push({
      cmd: `axaraaudit fix${all ? ' --all' : ''}${ai ? ' --ai' : ''} --write`,
      why: tr('appliquez ce que vous venez de prévisualiser', 'apply what you just previewed'),
    });
  }
  if (write && (totalApplied > 0 || aiFixedFiles > 0)) {
    tips.push({
      cmd: 'axaraaudit audit',
      why: tr('mesurez le nouveau score après corrections', 'measure the new score after the fixes'),
    });
  }
  if (!all && remaining.some((issue) => issue.match === 'nearest-token')) {
    tips.push({
      cmd: `axaraaudit fix --all${write ? ' --write' : ''}`,
      why: tr('inclut aussi les tokens proches (confiance ≥ 0.7)', 'also includes close tokens (confidence ≥ 0.7)'),
    });
  }
  if (!ai) {
    tips.push({
      cmd: `axaraaudit fix --ai${write ? ' --write' : ''}`,
      why: tr(
        'corrige aussi le RGAA (alt, labels, titres…) et les valeurs sans token via Claude',
        'also fixes RGAA issues (alt, labels, headings…) and token-less values via Claude',
      ),
    });
  }
  printTips(tips.slice(0, 3));
  return 0;
}
