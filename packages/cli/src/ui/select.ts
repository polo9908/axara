/**
 * Sélecteur à choix unique — zéro dépendance (mode raw de stdin + redraw ANSI).
 *
 * ↑↓ navigue, Entrée valide, Échap/Ctrl-C annule (retourne null). Réservé aux
 * TTY interactifs : l'appelant vérifie `canSelect()` (sinon, prendre le défaut).
 */

import { boldOn, clipFrame, cursor, paintFg, reset, stdoutLevel, type ColorLevel } from './ansi.js';
import { BRAND } from './theme.js';

const ESC = '';
const CTRL_C = '';

export interface SelectChoice {
  /** Valeur retournée quand ce choix est validé. */
  readonly value: string;
  /** Libellé court affiché en couleur d'accent. */
  readonly label: string;
  /** Détail optionnel (vitesse, coût…), affiché en retrait. */
  readonly detail?: string;
}

export function canSelect(): boolean {
  return (
    process.stdin.isTTY === true && process.stdout.isTTY === true && process.env['CI'] === undefined
  );
}

function render(
  title: string,
  choices: readonly SelectChoice[],
  selected: number,
  level: ColorLevel,
): string {
  const b = (t: string): string => (level === 'none' ? t : `${boldOn(level)}${t}${reset(level)}`);
  const lines: string[] = [];
  lines.push(`  ${paintFg('❯', BRAND.pink, level)} ${b(title)}`);
  const width = Math.max(...choices.map((c) => c.label.length));
  choices.forEach((choice, i) => {
    const active = i === selected;
    const marker = active ? paintFg('▸', BRAND.pink, level) : ' ';
    const label = paintFg(choice.label.padEnd(width), BRAND.cyan, level);
    const detail =
      choice.detail !== undefined
        ? ` ${paintFg(choice.detail, active ? BRAND.pink : BRAND.slate, level)}`
        : '';
    lines.push(`   ${marker} ${active ? b(label) : label}${detail}`);
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Affiche `title` et la liste, retourne la `value` choisie ou null (annulé).
 * `initial` présélectionne un index (défaut : premier choix).
 */
export function selectOption(
  title: string,
  choices: readonly SelectChoice[],
  initial = 0,
): Promise<string | null> {
  const level = stdoutLevel;
  const stdin = process.stdin;
  let selected = Math.min(Math.max(0, initial), choices.length - 1);
  let renderedLines = 0;

  const draw = (): void => {
    // Tronqué à la largeur du terminal : aucun enroulement, comptage exact.
    const frame = clipFrame(render(title, choices, selected, level), process.stdout.columns ?? 80);
    const erase =
      renderedLines > 0 ? `${cursor.up(renderedLines)}${cursor.toColumn0}${cursor.eraseDown}` : '';
    process.stdout.write(`${erase}${frame}`);
    renderedLines = frame.split('\n').length - 1; // le cadre se termine par \n
  };

  return new Promise((resolvePick) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    process.stdout.write(cursor.hide);
    draw();

    const finish = (pick: string | null): void => {
      stdin.off('data', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write(
        `${cursor.up(renderedLines)}${cursor.toColumn0}${cursor.eraseDown}${cursor.show}`,
      );
      if (pick !== null) {
        const chosen = choices.find((c) => c.value === pick);
        process.stdout.write(
          `  ${paintFg('❯', BRAND.pink, level)} ${paintFg(chosen?.label ?? pick, BRAND.cyan, level)}\n`,
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
        finish(choices[selected]?.value ?? null);
        return;
      }
      if (key === `${ESC}[A`) selected = Math.max(0, selected - 1); // ↑
      else if (key === `${ESC}[B`) selected = Math.min(choices.length - 1, selected + 1); // ↓
      draw();
    };

    stdin.on('data', onKey);
  });
}
