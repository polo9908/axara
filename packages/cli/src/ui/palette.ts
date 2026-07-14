/**
 * Palette de commandes interactive — le « / » de Claude Code, dans axaraaudit.
 *
 * Lancé sans argument sur un TTY, le CLI ouvre cette palette : l'utilisateur
 * tape pour filtrer (le `/` initial est toléré — mémoire musculaire), navigue
 * aux flèches, Tab complète, Entrée exécute, Échap quitte. Zéro dépendance :
 * mode raw de stdin + redraw ANSI.
 */

import { boldOn, cursor, frameRows, gradient, paintFg, reset, stdoutLevel, type ColorLevel } from './ansi.js';
import { BRAND } from './theme.js';
import { tr } from '../i18n.js';
import { GROUPS, type CommandSpec } from '../commands/help.js';

const ALL: readonly CommandSpec[] = GROUPS.flatMap((g) => g.commands);

const ESC = '\u001b';
const CTRL_C = '\u0003';
const BACKSPACE = '\u007f';

/** Minuscules sans accents : « Clé » ≈ « cle » — l'utilisateur tape comme il pense. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Barre de recherche par mots-clés. Chaque mot de la requête doit matcher
 * quelque part ; le score classe : préfixe du nom > nom > mot-clé (déclaré
 * dans le CATALOG, FR + EN) > définition. Tri stable → à score égal, l'ordre
 * du catalogue (par intention) est conservé. Exporté pour les tests.
 */
export function filterCommands(rawQuery: string): readonly CommandSpec[] {
  const query = fold(rawQuery.replace(/^\//, '').trim());
  if (query === '') return ALL;
  const words = query.split(/\s+/);

  const score = (cmd: CommandSpec): number => {
    const name = fold(cmd.name);
    const keywords = (cmd.keywords ?? []).map(fold);
    const brief = fold(cmd.brief);
    let total = 0;
    for (const word of words) {
      if (name.startsWith(word)) total += 100;
      else if (name.includes(word)) total += 60;
      else if (keywords.some((k) => k.startsWith(word))) total += 40;
      else if (keywords.some((k) => k.includes(word))) total += 30;
      else if (brief.includes(word)) total += 10;
      else return -1; // chaque mot doit matcher — sinon la commande sort
    }
    return total;
  };

  return ALL.map((cmd) => ({ cmd, s: score(cmd) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => b.s - a.s)
    .map(({ cmd }) => cmd);
}

/** La palette exige un vrai terminal interactif des deux côtés. */
export function paletteAvailable(): boolean {
  return (
    process.stdin.isTTY === true && process.stdout.isTTY === true && process.env['CI'] === undefined
  );
}

export interface PaletteOptions {
  /** Commande sélectionnée à l'ouverture (ex. 'audit' sur projet configuré). */
  readonly preselect?: string;
  /** Ligne de contexte affichée sous l'en-tête. */
  readonly hint?: string;
}

function render(
  query: string,
  matches: readonly CommandSpec[],
  selected: number,
  level: ColorLevel,
  hint?: string,
): string {
  const b = (t: string): string => (level === 'none' ? t : `${boldOn(level)}${t}${reset(level)}`);
  const lines: string[] = [];
  lines.push(
    `  ${gradient('axaraaudit', BRAND.violet, BRAND.cyan, level)} ${paintFg(tr('— cherchez par mot-clé (jeton, mcp, rapport…) · ↑↓ naviguer · Tab compléter · Entrée exécuter · Échap quitter', '— search by keyword (token, mcp, report…) · ↑↓ navigate · Tab complete · Enter run · Esc quit'), BRAND.slate, level)}`,
  );
  if (hint !== undefined) {
    lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${paintFg(hint, BRAND.slate, level)}`);
  }
  const caret = level === 'none' ? '_' : `${boldOn(level)}▌${reset(level)}`;
  lines.push(`  ${paintFg('❯', BRAND.pink, level)} ${b(`/${query}`)}${caret}`);
  if (matches.length === 0) {
    lines.push(`    ${paintFg(tr('(aucune commande ne correspond)', '(no command matches)'), BRAND.slate, level)}`);
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
export function runPalette(initialQuery = '', opts: PaletteOptions = {}): Promise<string | null> {
  const level = stdoutLevel;
  const stdin = process.stdin;
  let query = initialQuery.replace(/^\//, '');
  let selected = 0;
  if (opts.preselect !== undefined) {
    const at = filterCommands(query).findIndex((c) => c.name === opts.preselect);
    if (at >= 0) selected = at;
  }
  let renderedLines = 0;

  const draw = (): void => {
    const matches = filterCommands(query);
    if (selected >= matches.length) selected = Math.max(0, matches.length - 1);
    const frame = render(query, matches, selected, level, opts.hint);
    const erase =
      renderedLines > 0 ? `${cursor.up(renderedLines)}${cursor.toColumn0}${cursor.eraseDown}` : '';
    process.stdout.write(`${erase}${frame}`);
    renderedLines = frameRows(frame, process.stdout.columns ?? 80);
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
