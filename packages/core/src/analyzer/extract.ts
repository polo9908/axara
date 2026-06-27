/**
 * Extract color and dimension literals (with their offsets) from a CSS value
 * string. Offsets are relative to the start of the input and are used by the
 * analyzers to compute precise columns.
 */

import { isColor } from '../color/color.js';
import { isDimension } from '../dimension/dimension.js';

export interface Occurrence {
  readonly raw: string;
  /** 0-based offset within the scanned string. */
  readonly offset: number;
}

const NAMED_COLOR_WORDS = [
  'transparent',
  'black',
  'silver',
  'gray',
  'grey',
  'white',
  'maroon',
  'red',
  'purple',
  'fuchsia',
  'magenta',
  'green',
  'lime',
  'olive',
  'yellow',
  'navy',
  'blue',
  'teal',
  'aqua',
  'cyan',
  'orange',
  'pink',
  'gold',
  'indigo',
  'violet',
  'crimson',
  'coral',
  'salmon',
  'khaki',
  'tomato',
  'orchid',
  'turquoise',
  'slategray',
  'slategrey',
  'lightgray',
  'lightgrey',
  'darkgray',
  'darkgrey',
  'dimgray',
  'dimgrey',
  'whitesmoke',
  'gainsboro',
  'rebeccapurple',
];

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const FUNC_RE = /\b(?:rgba?|hsla?)\([^)]*\)/gi;
const NAMED_RE = new RegExp(`\\b(?:${NAMED_COLOR_WORDS.join('|')})\\b`, 'gi');
const DIMENSION_RE = /(?<![\w.#])-?\d*\.?\d+(?:px|rem|em|pt)\b/gi;

/** Replace `var(...)` segments with same-length blanks so we never flag them. */
function maskVarReferences(value: string): string {
  return value.replace(/var\([^)]*\)/gi, (m) => ' '.repeat(m.length));
}

function pushUnique(map: Map<number, Occurrence>, occ: Occurrence): void {
  if (!map.has(occ.offset)) map.set(occ.offset, occ);
}

/** All color literals in a CSS value (var() references are ignored). */
export function extractColors(value: string): Occurrence[] {
  const masked = maskVarReferences(value);
  const found = new Map<number, Occurrence>();

  for (const re of [HEX_RE, FUNC_RE, NAMED_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const raw = m[0];
      if (isColor(raw)) pushUnique(found, { raw, offset: m.index });
    }
  }

  // Drop hex/named matches that sit inside an already-captured function call.
  const occurrences = [...found.values()].sort((a, b) => a.offset - b.offset);
  return occurrences.filter((occ) => {
    if (!occ.raw.includes('(')) {
      const inside = occurrences.some(
        (other) =>
          other !== occ &&
          other.raw.includes('(') &&
          occ.offset > other.offset &&
          occ.offset < other.offset + other.raw.length,
      );
      return !inside;
    }
    return true;
  });
}

/** All dimension literals in a CSS value (var() references are ignored). */
export function extractDimensions(value: string): Occurrence[] {
  const masked = maskVarReferences(value);
  const found: Occurrence[] = [];
  DIMENSION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIMENSION_RE.exec(masked)) !== null) {
    const raw = m[0];
    if (isDimension(raw)) found.push({ raw, offset: m.index });
  }
  return found;
}
