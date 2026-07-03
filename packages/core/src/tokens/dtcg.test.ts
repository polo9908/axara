import { describe, expect, it } from 'vitest';
import { parseDtcg, parseDtcgString } from './dtcg.js';

const DOC = {
  color: {
    $type: 'color',
    brand: { $value: '#3b82f6', $description: 'Primary brand blue' },
    primary: { $value: '{color.brand}' },
    surface: { $value: 'rgb(255, 255, 255)' },
  },
  space: {
    $type: 'dimension',
    sm: { $value: '8px' },
    md: { $value: '0.5rem' },
  },
};

describe('parseDtcg', () => {
  it('flattens leaves with dot paths and css var names', () => {
    const { tokens } = parseDtcg(DOC);
    const brand = tokens.find((t) => t.path === 'color.brand');
    expect(brand).toBeDefined();
    expect(brand!.cssVar).toBe('--color-brand');
    expect(brand!.category).toBe('color');
    expect(brand!.description).toBe('Primary brand blue');
  });

  it('inherits $type from ancestor groups', () => {
    const { tokens } = parseDtcg(DOC);
    expect(tokens.find((t) => t.path === 'space.sm')!.type).toBe('dimension');
  });

  it('resolves aliases to their target value', () => {
    const { tokens } = parseDtcg(DOC);
    const primary = tokens.find((t) => t.path === 'color.primary')!;
    expect(primary.originalValue).toBe('{color.brand}');
    expect(primary.value).toBe('#3b82f6');
  });

  it('reports unknown alias targets', () => {
    const { errors } = parseDtcg({
      color: { $type: 'color', a: { $value: '{color.missing}' } },
    });
    expect(errors.some((e) => e.includes('unknown token'))).toBe(true);
  });

  it('detects alias cycles without infinite looping', () => {
    const { errors } = parseDtcg({
      color: {
        $type: 'color',
        a: { $value: '{color.b}' },
        b: { $value: '{color.a}' },
      },
    });
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
  });
});

describe('TokenIndex', () => {
  it('finds exact color tokens regardless of input format', () => {
    const { index } = parseDtcg(DOC);
    expect(index.exactColor('#3b82f6')!.path).toBe('color.brand');
    // surface defined as rgb(), queried as hex
    expect(index.exactColor('#ffffff')!.path).toBe('color.surface');
  });

  it('finds the nearest color token by perceptual distance', () => {
    const { index } = parseDtcg(DOC);
    const match = index.nearestColor('#3c83f7');
    expect(match!.token.path).toBe('color.brand');
    expect(match!.distance).toBeGreaterThan(0);
  });

  it('matches dimensions across units', () => {
    const { index } = parseDtcg(DOC);
    // both space.sm (8px) and space.md (0.5rem) normalize to 8px
    expect(index.exactDimension('8px')).not.toBeNull();
    expect(index.exactDimension('0.5rem')).not.toBeNull();
  });
});

describe('parseDtcgString', () => {
  it('returns an error for invalid JSON instead of throwing', () => {
    const { errors, tokens } = parseDtcgString('{ not json');
    expect(tokens).toHaveLength(0);
    expect(errors[0]).toMatch(/Invalid DTCG JSON/);
  });
});

describe('spacing-token preference for dimensions', () => {
  const { index } = parseDtcg({
    'font-size': { $type: 'dimension', base: { $value: '16px' } },
    space: { $type: 'dimension', '4': { $value: '16px' }, '5': { $value: '20px' } },
  });

  it('prefers a space.* token over font-size.* when both match exactly', () => {
    expect(index.exactDimension('16px')?.path).toBe('space.4');
  });

  it('prefers a space.* token on nearest-distance ties', () => {
    // 17px is 1px away from both font-size.base and space.4.
    expect(index.nearestDimension('17px')?.token.path).toBe('space.4');
  });

  it('still returns non-spacing tokens when they are the only match', () => {
    const single = parseDtcg({
      'font-size': { $type: 'dimension', xs: { $value: '11px' } },
    });
    expect(single.index.exactDimension('11px')?.path).toBe('font-size.xs');
  });
});
describe('spacing slack preference', () => {
  it('prefers a slightly-farther space.* token over a closer font-size.* (2px slack)', () => {
    const slack = parseDtcg({
      'font-size': { $type: 'dimension', sm: { $value: '13px' } },
      space: { $type: 'dimension', '3': { $value: '12px' } },
    });
    // 14px: font-size.sm is 1px away, space.3 is 2px away -> spacing wins.
    expect(slack.index.nearestDimension('14px')?.token.path).toBe('space.3');
  });
});