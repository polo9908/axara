/**
 * Moteur ANSI zéro-dépendance de la charte graphique AXARA.
 *
 * Trois niveaux de rendu, détectés par flux :
 *   - `truecolor` : dégradés 24 bits (Windows Terminal, iTerm2, VS Code…)
 *   - `ansi256`   : approximation sur le cube 256 couleurs
 *   - `none`      : sortie brute (NO_COLOR, pipe, CI)
 *
 * `AXARA_COLOR=always` (ou `FORCE_COLOR`) force le truecolor hors TTY —
 * pratique pour générer des captures marketing depuis un script.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type ColorLevel = 'none' | 'ansi256' | 'truecolor';

const ESC = String.fromCharCode(27);
const env = process.env;

const forced =
  env['AXARA_COLOR'] === 'always' ||
  (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0');

function detectLevel(stream: NodeJS.WriteStream): ColorLevel {
  if (env['NO_COLOR'] !== undefined) return 'none';
  if (forced) return 'truecolor';
  if (stream.isTTY !== true) return 'none';
  const colorterm = env['COLORTERM'] ?? '';
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 'truecolor';
  // Windows Terminal / conhost moderne et VS Code parlent 24 bits sans l'annoncer.
  if (env['WT_SESSION'] !== undefined || env['TERM_PROGRAM'] !== undefined) return 'truecolor';
  if (process.platform === 'win32') return 'truecolor';
  return 'ansi256';
}

export const stdoutLevel: ColorLevel = detectLevel(process.stdout);
export const stderrLevel: ColorLevel = detectLevel(process.stderr);

/** Les animations exigent un vrai TTY (réécriture de lignes), couleurs ou non. */
export const canAnimate: boolean =
  process.stderr.isTTY === true && env['CI'] === undefined && env['AXARA_NO_ANIM'] === undefined;

// ── Conversion RGB → cube 256 ──────────────────────────────────────────────

function to256(c: Rgb): number {
  if (c.r === c.g && c.g === c.b) {
    if (c.r < 8) return 16;
    if (c.r > 248) return 231;
    return 232 + Math.round(((c.r - 8) / 247) * 24);
  }
  const step = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * step(c.r) + 6 * step(c.g) + step(c.b);
}

export function fg(c: Rgb, level: ColorLevel = stdoutLevel): string {
  if (level === 'none') return '';
  if (level === 'ansi256') return `${ESC}[38;5;${to256(c)}m`;
  return `${ESC}[38;2;${c.r};${c.g};${c.b}m`;
}

export function bg(c: Rgb, level: ColorLevel = stdoutLevel): string {
  if (level === 'none') return '';
  if (level === 'ansi256') return `${ESC}[48;5;${to256(c)}m`;
  return `${ESC}[48;2;${c.r};${c.g};${c.b}m`;
}

export function reset(level: ColorLevel = stdoutLevel): string {
  return level === 'none' ? '' : `${ESC}[0m`;
}

export function boldOn(level: ColorLevel = stdoutLevel): string {
  return level === 'none' ? '' : `${ESC}[1m`;
}

export function paintFg(text: string, c: Rgb, level: ColorLevel = stdoutLevel): string {
  return level === 'none' ? text : `${fg(c, level)}${text}${reset(level)}`;
}

// ── Dégradés ───────────────────────────────────────────────────────────────

export function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  const m = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * m),
    g: Math.round(a.g + (b.g - a.g) * m),
    b: Math.round(a.b + (b.b - a.b) * m),
  };
}

/** Applique un dégradé horizontal caractère par caractère (espaces exclus). */
export function gradient(
  text: string,
  from: Rgb,
  to: Rgb,
  level: ColorLevel = stdoutLevel,
): string {
  if (level === 'none') return text;
  const chars = [...text];
  const span = Math.max(1, chars.length - 1);
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? '';
    out += ch === ' ' ? ch : `${fg(lerp(from, to, i / span), level)}${ch}`;
  }
  return `${out}${reset(level)}`;
}

/** Dégradé multi-lignes : la teinte suit la colonne, pas la ligne — effet bannière. */
export function gradientBlock(
  lines: readonly string[],
  from: Rgb,
  to: Rgb,
  level: ColorLevel = stdoutLevel,
): string[] {
  if (level === 'none') return [...lines];
  const width = Math.max(1, ...lines.map((l) => [...l].length));
  return lines.map((line) => {
    const chars = [...line];
    let out = '';
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i] ?? '';
      out += ch === ' ' ? ch : `${fg(lerp(from, to, i / Math.max(1, width - 1)), level)}${ch}`;
    }
    return `${out}${reset(level)}`;
  });
}

// ── Mesure de largeur (redraw sans résidus) ─────────────────────────────────

const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

/** Largeur affichée : hors séquences ANSI, comptée en points de code. */
export function displayWidth(text: string): number {
  return [...text.replace(ANSI_PATTERN, '')].length;
}

/**
 * Nombre de lignes *visuelles* qu'occupe `frame` sur un terminal de `columns`
 * colonnes — une ligne plus longue que la largeur s'enroule sur plusieurs
 * rangées. Indispensable au redraw : un `cursor.up(n)` calé sur les seuls `\n`
 * sous-compte les lignes enroulées, l'effacement ne remonte pas assez haut et
 * laisse des résidus (en-tête « dupliqué » à chaque flèche).
 */
export function frameRows(frame: string, columns: number): number {
  const cols = Math.max(1, columns);
  const lines = frame.split('\n');
  if (lines[lines.length - 1] === '') lines.pop(); // \n final → dernière entrée vide
  let rows = 0;
  for (const line of lines) rows += Math.max(1, Math.ceil(displayWidth(line) / cols));
  return rows;
}

// ── Curseur (animations) ───────────────────────────────────────────────────

export const cursor = {
  hide: `${ESC}[?25l`,
  show: `${ESC}[?25h`,
  up: (n: number): string => (n > 0 ? `${ESC}[${n}A` : ''),
  toColumn0: '\r',
  eraseLine: `${ESC}[2K`,
  eraseDown: `${ESC}[0J`,
} as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
