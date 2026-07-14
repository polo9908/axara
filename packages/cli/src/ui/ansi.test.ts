import { describe, expect, it } from 'vitest';
import { displayWidth, frameRows, paintFg } from './ansi.js';
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
