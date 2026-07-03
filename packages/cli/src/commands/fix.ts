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
  auditSources,
  auditHtmlRgaa,
  fixFile,
  jsxToHtml,
  PAGE_SCOPED_RULES,
  type DesignToken,
  type DriftIssue,
  type RgaaFinding,
  type SourceFile,
} from '@axaraaudit/core';
import { ConfigError, loadRc } from '../config/rc.js';
import { loadTokensSource } from '../config/tokens-source.js';
import { resolveAnthropicKey } from '../config/credentials.js';
import { requestFileFix, ClaudeError, CLAUDE_MODEL } from '../services/claude.js';
import { collectFiles } from '../scan/walk.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';

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
  if (lines.length >= maxLines) lines.push(dim('    … (diff tronqué)'));
  return lines.join('\n');
}

function describeDriftIssue(issue: DriftIssue): string {
  const suggestion =
    issue.suggestion !== undefined
      ? ` ; token le plus proche : ${issue.suggestion.replacement} (${issue.suggestion.tokenValue})`
      : '';
  return `Design drift L${issue.line} — ${issue.property}: ${issue.value} (aucun token exact${suggestion})`;
}

function describeRgaaFinding(finding: RgaaFinding): string {
  const impact = finding.impact ?? 'impact inconnu';
  const sample = finding.occurrences[0]?.html.slice(0, 160) ?? '';
  return `RGAA ${finding.criterion} — ${finding.criterionTitle} (${impact}). Élément : ${sample}`;
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
    throw new ConfigError(`--min-confidence doit être un nombre entre 0 et 1 (reçu: ${rawConfidence}).`);
  }

  const loaded = loadRc(process.cwd(), values.config);
  const filePaths = collectFiles(
    loaded.rootDir,
    loaded.rc.include,
    loaded.rc.exclude,
    loaded.rc.extensions,
  );
  const files: SourceFile[] = filePaths.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));

  const tokensSource = loadTokensSource(loaded, values.tokens, files);
  const tokensJson = tokensSource.json;
  if (tokensSource.origin === 'auto') {
    process.stderr.write(green(`✓ Zéro-config : ${tokensSource.detail}.\n`));
  }

  const report = auditSources(tokensJson, files, { remBasePx: loaded.rc.remBasePx });

  const byFile = new Map<string, DriftIssue[]>();
  for (const issue of report.issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  const rel = (path: string): string => relative(loaded.rootDir, path);

  out(`\n${bold(write ? '  AUTO-FIX — ÉCRITURE' : '  AUTO-FIX — PRÉVISUALISATION (dry-run)')}`);
  out(all ? dim(`  (mode --all, confiance ≥ ${minConfidence})`) : '');
  out(ai ? dim('  (+ passe IA)') : '');
  out('\n\n');

  // ── 1. Mechanical pass (exact tokens, plus near-misses with --all) ──
  let totalApplied = 0;
  const appliedKeys = new Set<string>();
  for (const [path, issues] of byFile) {
    const result = fixFile(path, issues, {
      dryRun: !write,
      onlyAutoFixable: !all,
      minConfidence,
    });
    totalApplied += result.applied.length;
    if (result.applied.length === 0) continue;

    out(`  ${cyan(rel(path))}\n`);
    for (const fix of result.applied) {
      appliedKeys.add(`${path}:${fix.line}:${fix.column}`);
      out(`    ${green('✓')} ${dim(`L${fix.line}`)}  ${fix.from} → ${green(fix.to)}\n`);
    }
  }
  if (totalApplied === 0) out(dim('  (aucune correction mécanique applicable)\n'));

  const remaining = report.issues.filter(
    (issue) => !appliedKeys.has(`${issue.file}:${issue.line}:${issue.column}`),
  );

  // ── 2. Optional AI pass (RGAA + drifts the mechanics could not solve) ──
  let aiFixedFiles = 0;
  let aiInputTokens = 0;
  let aiOutputTokens = 0;
  if (ai) {
    const apiKey = resolveAnthropicKey();
    if (apiKey === null) {
      out('\n');
      out(`${yellow('  ✦ Correction IA non configurée.')}\n`);
      out('  Pour l\'activer (2 minutes) :\n');
      out(`    1. Créez une clé API sur ${cyan('https://console.anthropic.com/settings/keys')}\n`);
      out(`    2. ${bold('axaraaudit login --anthropic-key sk-ant-...')}\n`);
      out(dim('       (ou définissez la variable d\'environnement ANTHROPIC_API_KEY)\n'));
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

    out(`\n${bold('  PASSE IA')} ${dim(`(${values.model ?? CLAUDE_MODEL})`)}\n`);
    if (aiWork.size === 0) {
      out(green('    ✓ Rien à corriger par IA.\n'));
    } else {
      out(dim(`  ${aiWork.size} fichier(s) envoyé(s) à l'API Anthropic (opt-in --ai).\n`));
      const catalog = tokensCatalog(report.tokens);

      for (const [path, issues] of aiWork) {
        // Re-read: the mechanical pass may have just rewritten the file.
        const source = readFileSync(path, 'utf8');
        out(`\n  ${cyan(rel(path))} ${dim(`(${issues.length} problème(s))`)}\n`);
        try {
          const result = await requestFileFix(
            apiKey,
            { file: rel(path), source, issues, tokensCatalog: catalog },
            values.model !== undefined ? { model: values.model } : {},
          );
          aiInputTokens += result.inputTokens;
          aiOutputTokens += result.outputTokens;

          if (result.content.trimEnd() === source.trimEnd()) {
            out(dim('    (aucune modification proposée)\n'));
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
            out(green('    ✓ Fichier corrigé par IA\n'));
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
          `\n  Utilisation API : ${aiInputTokens} tokens d'entrée, ${aiOutputTokens} tokens de sortie.\n`,
        ),
      );
    }
  }

  // ── 3. Exhaustive remainder (only meaningful without the AI pass) ──
  if (!ai && remaining.length > 0) {
    const nearMisses = remaining.filter((issue) => issue.match === 'nearest-token');
    const noToken = remaining.filter((issue) => issue.match === 'no-token');
    out(`\n${bold('  NON CORRIGÉ')} ${dim(`(${remaining.length})`)}\n`);
    if (nearMisses.length > 0) {
      out(yellow(`  Valeurs proches d'un token — vérifiez puis relancez avec --all :\n`));
      for (const issue of nearMisses) {
        const s = issue.suggestion;
        out(
          `    ${yellow('≈')} ${dim(`${rel(issue.file)}:L${issue.line}`)}  ${issue.value} → ${
            s !== undefined ? `${s.replacement} ${dim(`(confiance ${s.confidence})`)}` : ''
          }\n`,
        );
      }
    }
    if (noToken.length > 0) {
      out(red(`  Aucun token proche — décision manuelle, ou déléguez à l'IA avec --ai :\n`));
      for (const issue of noToken) {
        out(`    ${red('✖')} ${dim(`${rel(issue.file)}:L${issue.line}`)}  ${issue.property}: ${issue.value}\n`);
      }
    }
  }

  // ── Summary ──
  out(`\n  ${green(String(totalApplied))} correction(s) mécanique(s) ${write ? 'appliquée(s)' : 'applicable(s)'}`);
  if (ai) out(`, ${green(String(aiFixedFiles))} fichier(s) corrigé(s) par IA`);
  else out(`, ${String(remaining.length)} restante(s)`);
  out('\n');
  if (!write && (totalApplied > 0 || aiFixedFiles > 0)) {
    out(dim('  Relancez avec --write pour appliquer.\n'));
  }
  if (!ai) {
    out(
      dim(
        '  Astuce : `axaraaudit fix --ai` corrige aussi le RGAA (alt, labels, titres…) et les valeurs sans token via Claude.\n',
      ),
    );
  }
  out('\n');
  return 0;
}
