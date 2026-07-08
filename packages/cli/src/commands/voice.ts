/**
 * `axaraaudit voice` — hear your components the way a screen reader user does.
 *
 * Prints the utterances a French screen reader would announce while reading
 * each component top to bottom, highlighting every degraded announcement
 * (unnamed link, missing alt, unlabeled field…) with its RGAA criterion.
 * No tokens, no config and no browser required.
 */

import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { jsxToHtml, simulateScreenReader, type VoiceAnnouncement } from '@axaraaudit/core';
import { ConfigError, loadRc } from '../config/rc.js';
import { tr } from '../i18n.js';
import { collectFiles } from '../scan/walk.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';
import { printTips } from '../ui/tips.js';

const JSX_EXT = new Set(['.tsx', '.jsx']);
const HTML_EXT = new Set(['.html', '.htm']);

function toHtml(path: string, content: string): string | null {
  const ext = extname(path).toLowerCase();
  if (JSX_EXT.has(ext)) return jsxToHtml(content);
  if (HTML_EXT.has(ext)) return content;
  return null;
}

function renderAnnouncement(a: VoiceAnnouncement): string {
  const speaker = a.warning !== undefined ? red('🔊') : dim('🔊');
  const text =
    a.kind === 'text'
      ? dim(`« ${a.utterance} »`)
      : a.kind === 'region'
        ? cyan(a.utterance)
        : a.utterance;
  const warn =
    a.warning !== undefined
      ? `\n       ${red(`⚠ RGAA ${a.warning.criterion}`)} ${red('—')} ${a.warning.message}`
      : '';
  return `    ${speaker} ${text}${warn}`;
}

export async function runVoice(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { config: { type: 'string' } },
    allowPositionals: true,
  });

  const cwd = process.cwd();
  const loaded = loadRc(cwd, values.config);

  let targets: string[];
  if (positionals.length > 0) {
    targets = positionals.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)));
  } else {
    targets = collectFiles(loaded.rootDir, loaded.rc.include, loaded.rc.exclude, [
      '.tsx',
      '.jsx',
      '.html',
      '.htm',
    ]);
  }
  if (targets.length === 0) {
    throw new ConfigError(
      tr('Aucun composant (.tsx/.jsx/.html) à lire.', 'No component (.tsx/.jsx/.html) to read.'),
    );
  }

  process.stdout.write(`\n${bold(tr('  🎧 SIMULATION LECTEUR D’ÉCRAN', '  🎧 SCREEN READER SIMULATION'))}\n`);
  process.stdout.write(
    dim(
      tr(
        '  Ce que vos utilisateurs aveugles ou malvoyants entendent réellement.\n',
        '  What your blind or low-vision users actually hear.\n',
      ),
    ),
  );

  let totalAnnouncements = 0;
  let totalWarnings = 0;

  for (const path of targets) {
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      process.stderr.write(red(tr(`Fichier introuvable : ${path}\n`, `File not found: ${path}\n`)));
      return 2;
    }
    const html = toHtml(path, content);
    if (html === null || html.trim() === '') continue;

    const announcements = simulateScreenReader(html);
    if (announcements.length === 0) continue;

    process.stdout.write(`\n  ${cyan(relative(loaded.rootDir, path))}\n`);
    for (const a of announcements) {
      process.stdout.write(`${renderAnnouncement(a)}\n`);
      totalAnnouncements += 1;
      if (a.warning !== undefined) totalWarnings += 1;
    }
  }

  process.stdout.write('\n');
  if (totalWarnings === 0) {
    process.stdout.write(
      green(
        tr(
          `  ✓ ${totalAnnouncements} annonce(s), toutes exploitables. Vos utilisateurs vous remercient.\n`,
          `  ✓ ${totalAnnouncements} announcement(s), all usable. Your users thank you.\n`,
        ),
      ),
    );
  } else {
    process.stdout.write(
      `  ${yellow(tr(`${totalWarnings} annonce(s) dégradée(s)`, `${totalWarnings} degraded announcement(s)`))}${tr(
        ` sur ${totalAnnouncements} — invisible à l'œil, criant à l'oreille.\n`,
        ` out of ${totalAnnouncements} — invisible to the eye, glaring to the ear.\n`,
      )}`,
    );
    const firstTarget = targets[0];
    printTips([
      {
        cmd: 'axaraaudit fix --ai --write',
        why: tr('corrige alt, labels et titres manquants via Claude', 'fixes missing alt, labels and titles via Claude'),
      },
      ...(firstTarget !== undefined
        ? [
            {
              cmd: `axaraaudit voice ${relative(loaded.rootDir, firstTarget)}`,
              why: tr('réécoutez après correction', 'listen again after fixing'),
            },
          ]
        : []),
    ]);
    return 0;
  }
  process.stdout.write('\n');
  return 0;
}
