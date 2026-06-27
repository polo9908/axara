import { describe, expect, it } from 'vitest';
import { colorDistance, isColor, parseColor, toHex } from './color.js';

describe('parseColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseColor('#3b82f6')).toEqual({ r: 59, g: 130, b: 246, a: 1 });
  });

  it('parses 3-digit hex by doubling nibbles', () => {
    expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  });

  it('parses 8-digit hex with alpha', () => {
    const c = parseColor('#ff000080');
    expect(c).not.toBeNull();
    expect(c!.r).toBe(255);
    expect(c!.a).toBeCloseTo(0x80 / 255, 5);
  });

  it('parses rgb() and rgba() in both syntaxes', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(0,0,0,0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it('parses hsl() to the expected rgb', () => {
    // pure red
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    // pure white
    expect(parseColor('hsl(0, 0%, 100%)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('parses named colors and transparent', () => {
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('returns null for non-colors', () => {
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('#xyz')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('toHex', () => {
  it('round-trips an opaque color', () => {
    expect(toHex({ r: 59, g: 130, b: 246, a: 1 })).toBe('#3b82f6');
  });

  it('appends alpha only when below 1', () => {
    expect(toHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080');
  });

  it('normalizes equivalent inputs to the same canonical form', () => {
    expect(toHex(parseColor('rgb(59,130,246)')!)).toBe(toHex(parseColor('#3b82f6')!));
  });
});

describe('colorDistance', () => {
  it('is zero for identical colors', () => {
    const c = parseColor('#3b82f6')!;
    expect(colorDistance(c, c)).toBe(0);
  });

  it('orders near and far colors correctly', () => {
    const base = parseColor('#3b82f6')!;
    const near = parseColor('#3c82f6')!;
    const far = parseColor('#ff0000')!;
    expect(colorDistance(base, near)).toBeLessThan(colorDistance(base, far));
  });
});

describe('isColor', () => {
  it('recognizes colors', () => {
    expect(isColor('#fff')).toBe(true);
    expect(isColor('rebeccapurple')).toBe(true);
    expect(isColor('12px')).toBe(false);
  });
});
