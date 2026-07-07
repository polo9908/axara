/**
 * Palette de commandes interactive — le « / » de Claude Code, dans axaraaudit.
 *
 * Lancé sans argument sur un TTY, le CLI ouvre cette palette : l'utilisateur
 * tape pour filtrer (le `/` initial est toléré — mémoire musculaire), navigue
 * aux flèches, Tab complète, Entrée exécute, Échap quitte. Zéro dépendance :
 * mode raw de stdin + redraw ANSI.
 */

import { boldOn, cursor, gradient, paintFg, reset, stdoutLevel, type ColorLevel } from './ansi.js';
import { BRAND } from './theme.js';
import { GROUPS, type CommandSpec } from '../commands/help.js';

const ALL: readonly CommandSpec[] = GROUPS.flatMap((g) => g.commands);

const ESC = '\u001b';
const CTRL_C = '\u0003';
const BACKSPACE = '\u007f';

/** Filtre : préfixe d'abord, puis inclusion (nom ou définition). Exporté pour les tests. */
export function filterCommands(rawQuery: string): readonly CommandSpec[] {
  const query = rawQuery.replace(/^\//, '').trim().toLowerCase();
  if (query === '') return ALL;
  const starts = ALL.filter((c) => c.name.startsWith(query));
  const includes = ALL.filter(
    (c) => !c.name.startsWith(query) && (c.name.includes(query) || c.brief.toLowerCase().includes(query)),
  );
  return [...starts, ...includes];
}

/** La palette exige un vrai terminal interactif des deux côtés. */
export function paletteAvailable(): boolean {
  return (
    process.stdin.isTTY === true && process.stdout.isTTY === true && process.env['CI'] === undefined
  );
}

function render(
  query: string,
  matches: readonly CommandSpec[],
  selected: number,
  level: ColorLevel,
): string {
  const b = (t: string): string => (level === 'none' ? t : `${boldOn(level)}${t}${reset(level)}`);
  const lines: string[] = [];
  lines.push(
    `  ${gradient('axaraaudit', BRAND.violet, BRAND.cyan, level)} ${paintFg('— tapez pour filtrer · ↑↓ naviguer · Tab compléter · Entrée exécuter · Échap quitter', BRAND.slate, level)}`,
  );
  const caret = level === 'none' ? '_' : `${boldOn(level)}▌${reset(level)}`;
  lines.push(`  ${paintFg('❯', BRAND.pink, level)} ${b(`/${query}`)}${caret}`);
  if (matches.length === 0) {
    lines.push(`    ${paintFg('(aucune commande ne correspond)', BRAND.slate, level)}`);
  }
  matches.forEach((cmd, i) => {
    const active = i === selected;
    const marker = active ? paintFg('▸', BRAND.pink, level) : ' ';
    const name = paintFg(cmd.name.padEnd(9), BRAND.cyan, level);
    const brief = paintFg(cmd.brief, active ? BRAND.pink : BRAND.slate, level);
    lines.push(`   ${marker} ${active ? b(name) : name} ${brief}`);
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Ouvre la palette et retourne le nom de la commande choisie, ou null
 * (Échap / Ctrl-C). `initialQuery` pré-remplit le filtre (`axaraaudit /aud`).
 */
export function runPalette(initialQuery = ''): Promise<string | null> {
  const level = stdoutLevel;
  const stdin = process.stdin;
  let query = initialQuery.replace(/^\//, '');
  let selected = 0;
  let renderedLines = 0;

  const draw = (): void => {
    const matches = filterCommands(query);
    if (selected >= matches.length) selected = Math.max(0, matches.length - 1);
    const frame = render(query, matches, selected, level);
    const erase =
      renderedLines > 0 ? `${cursor.up(renderedLines)}${cursor.toColumn0}${cursor.eraseDown}` : '';
    process.stdout.write(`${erase}${frame}`);
    renderedLines = frame.split('\n').length - 1;
  };

  return new Promise((resolvePick) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    process.stdout.write(`${cursor.hide}\n`);
    draw();

    const finish = (pick: string | null): void => {
      stdin.off('data', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write(
        `${cursor.up(renderedLines)}${cursor.toColumn0}${cursor.eraseDown}${cursor.show}`,
      );
      if (pick !== null) {
        process.stdout.write(
          `  ${paintFg('❯', BRAND.pink, level)} ${paintFg(`axaraaudit ${pick}`, BRAND.cyan, level)}\n`,
        );
      }
      resolvePick(pick);
    };

    const onKey = (key: string): void => {
      if (key === CTRL_C || key === ESC) {
        finish(null);
        return;
      }
      if (key === '\r' || key === '\n') {
        const pick = filterCommands(query)[selected];
        finish(pick !== undefined ? pick.name : null);
        return;
      }
      if (key === `${ESC}[A`) {
        selected = Math.max(0, selected - 1); // ↑
      } else if (key === `${ESC}[B`) {
        selected = Math.min(filterCommands(query).length - 1, selected + 1); // ↓
      } else if (key === BACKSPACE || key === '\b') {
        query = query.slice(0, -1);
      } else if (key === '\t') {
        const current = filterCommands(query)[selected];
        if (current !== undefined) query = current.name;
      } else if (key >= ' ' && !key.startsWith(ESC)) {
        // `/` toléré en tête de saisie (mémoire musculaire Claude Code).
        query = (query + key).replace(/^\//, '');
        selected = 0;
      }
      draw();
    };

    stdin.on('data', onKey);
  });
}
