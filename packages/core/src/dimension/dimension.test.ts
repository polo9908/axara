import { describe, expect, it } from 'vitest';
import { dimensionDistance, isDimension, parseDimension } from './dimension.js';

describe('parseDimension', () => {
  it('parses px', () => {
    expect(parseDimension('8px')).toEqual({ value: 8, unit: 'px', px: 8 });
  });

  it('normalizes rem using the rem base', () => {
    expect(parseDimension('0.5rem')).toEqual({ value: 0.5, unit: 'rem', px: 8 });
    expect(parseDimension('1rem', 10)).toEqual({ value: 1, unit: 'rem', px: 10 });
  });

  it('normalizes pt to px', () => {
    const d = parseDimension('12pt');
    expect(d!.px).toBeCloseTo(16, 5);
  });

  it('accepts a bare zero as 0px', () => {
    expect(parseDimension('0')).toEqual({ value: 0, unit: '', px: 0 });
  });

  it('rejects non-zero unitless and non-lengths', () => {
    expect(parseDimension('8')).toBeNull();
    expect(parseDimension('50%')).toBeNull();
    expect(parseDimension('auto')).toBeNull();
    expect(parseDimension('calc(1px + 2px)')).toBeNull();
  });
});

describe('dimensionDistance', () => {
  it('compares across units after normalization', () => {
    const a = parseDimension('0.5rem')!; // 8px
    const b = parseDimension('8px')!;
    expect(dimensionDistance(a, b)).toBe(0);
  });
});

describe('isDimension', () => {
  it('recognizes lengths', () => {
    expect(isDimension('16px')).toBe(true);
    expect(isDimension('red')).toBe(false);
  });
});
