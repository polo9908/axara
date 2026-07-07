#!/usr/bin/env node
/**
 * AxaraAudit — Claude Code PostToolUse hook.
 *
 * Fires after every Edit/Write. If the touched file is UI code
 * (.tsx/.jsx/.html/.css/…), it runs `axaraaudit check <file> --format json`
 * and, when violations are found, feeds them back to the model as a `block`
 * decision so the agent fixes its own output immediately — accessible and
 * token-correct *by construction*.
 *
 * Fail-open by design: any internal problem (CLI missing, timeout, parse
 * error) exits 0 silently. A quality hook must never break a coding session.
 *
 * CLI resolution order:
 *   1. $AXARA_CLI               (explicit path to the CLI entry, dev/CI)
 *   2. project-local install    (node_modules/@axaraaudit/cli)
 *   3. npx -y @axaraaudit/cli   (cold but universal)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const UI_EXTENSIONS = new Set([
  '.tsx', '.jsx', '.html', '.htm', '.css', '.scss', '.less', '.vue',
]);
const CHECK_TIMEOUT_MS = 45_000;
const MAX_REPORTED = 10;

function readStdin() {
  try {
    return readFileSync(0, 'utf8'); // fd 0: the hook event JSON
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  if (raw.trim() === '') return;

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }

  const filePath = event?.tool_input?.file_path;
  const cwd = event?.cwd ?? process.cwd();
  if (typeof filePath !== 'string' || filePath === '') return;
  if (!UI_EXTENSIONS.has(extname(filePath).toLowerCase())) return;
  if (!existsSync(filePath)) return;

  const result = runCheck(filePath, cwd);
  if (result === null || result.exitCode !== 1) return; // 0 = conformant, ≥2 = config problem → stay silent

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    return;
  }

  const reason = formatReason(filePath, payload);
  if (reason === null) return;

  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function runCheck(filePath, cwd) {
  const args = ['check', filePath, '--format', 'json'];
  const options = { cwd, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS };

  const explicit = process.env.AXARA_CLI;
  if (explicit && existsSync(explicit)) {
    return capture(spawnSync(process.execPath, [explicit, ...args], options));
  }

  const local = join(cwd, 'node_modules', '@axaraaudit', 'cli', 'dist', 'index.js');
  if (existsSync(local)) {
    return capture(spawnSync(process.execPath, [local, ...args], options));
  }

  return capture(
    spawnSync('npx', ['-y', '@axaraaudit/cli', ...args], {
      ...options,
      shell: process.platform === 'win32', // npx is npx.cmd on Windows
    }),
  );
}

function capture(spawned) {
  if (spawned.error !== undefined || spawned.status === null) return null;
  return { exitCode: spawned.status, stdout: spawned.stdout ?? '' };
}

function formatReason(filePath, payload) {
  // Prefer the project-relative path computed by the CLI.
  const displayPath = payload.files?.[0]?.file ?? filePath;
  const problems = [];
  for (const file of payload.files ?? []) {
    for (const finding of file.rgaa ?? []) {
      const impact = finding.impact ?? 'impact inconnu';
      const sample = finding.sample ? ` — élément : ${finding.sample}` : '';
      problems.push(`- RGAA ${finding.criterion} (${impact}) : ${finding.title}${sample}`);
    }
    for (const issue of file.drift ?? []) {
      const fix = issue.replacement
        ? ` → remplace par ${issue.replacement}`
        : ' (aucun token proche : choisis le token le plus adapté du design system)';
      problems.push(`- L${issue.line} ${issue.property}: ${issue.value}${fix}`);
    }
  }
  if (problems.length === 0) return null;

  const shown = problems.slice(0, MAX_REPORTED);
  const hidden = problems.length - shown.length;
  return (
    `AxaraAudit : ${problems.length} problème(s) d'accessibilité/design system dans ${displayPath} :\n` +
    shown.join('\n') +
    (hidden > 0 ? `\n… et ${hidden} autre(s) (lance \`axaraaudit check ${displayPath}\`).` : '') +
    `\nCorrige ce fichier immédiatement : utilise les tokens var(--…) indiqués au lieu des valeurs en dur, ` +
    `et ajoute les attributs d'accessibilité requis (alt, label, nom accessible…). ` +
    `La correction sera revalidée automatiquement à la prochaine écriture.`
  );
}

main();
