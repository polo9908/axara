import { describe, expect, it } from 'vitest';
import { clipFrame, clipLine, displayWidth, frameRows, paintFg } from './ansi.js';
import { BRAND } from './theme.js';

describe('displayWidth', () => {
  it('ignore les séquences ANSI', () => {
    const painted = paintFg('audit', BRAND.cyan, 'truecolor');
    expect(displayWidth(painted)).toBe(5);
  });

  it('compte les points de code, pas les octets UTF-16', () => {
    expect(displayWidth('↑↓ Échap')).toBe(8);
  });
});

describe('frameRows', () => {
  it('compte une rangée par ligne courte', () => {
    expect(frameRows('a\nb\nc\n', 80)).toBe(3);
  });

  it('ignore le \\n final', () => {
    expect(frameRows('a\n', 80)).toBe(1);
  });

  it("compte les rangées d'enroulement d'une ligne trop longue", () => {
    const line = 'x'.repeat(25);
    expect(frameRows(`${line}\n`, 10)).toBe(3); // ceil(25/10)
  });

  it('mesure la largeur hors séquences ANSI avant enroulement', () => {
    const line = paintFg('x'.repeat(25), BRAND.cyan, 'truecolor');
    expect(frameRows(`${line}\n`, 10)).toBe(3); // les codes ANSI ne comptent pas
  });
});

describe('clipLine', () => {
  it('rend le texte intact quand il tient', () => {
    expect(clipLine('court', 10)).toBe('court');
  });

  it('tronque le texte brut à la largeur visible', () => {
    expect(clipLine('abcdefghij', 4)).toBe('abcd');
  });

  it('préserve les séquences ANSI et referme le style au point de coupe', () => {
    const painted = paintFg('abcdefghij', BRAND.cyan, 'truecolor');
    const clipped = clipLine(painted, 4);
    expect(displayWidth(clipped)).toBe(4);
    expect(clipped.replace(/\[[0-9;?]*[A-Za-z]/g, '')).toBe('abcd');
    expect(clipped.endsWith('[0m')).toBe(true);
  });

  it('coupe en points de code, jamais au milieu d’un surrogate pair', () => {
    expect(clipLine('a𝒳b', 2)).toBe('a𝒳');
  });
});

describe('clipFrame', () => {
  it('tronque chaque ligne à columns - 1 : plus aucun enroulement possible', () => {
    const frame = `${'x'.repeat(30)}\ncourt\n`;
    const clipped = clipFrame(frame, 10);
    const lines = clipped.split('\n');
    expect(lines[0]).toBe('x'.repeat(9));
    expect(lines[1]).toBe('court');
    // Après troncature, le nombre de rangées == nombre de lignes, sur tout terminal.
    expect(frameRows(clipped, 10)).toBe(2);
  });
});
