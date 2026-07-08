import { describe, expect, it } from 'vitest';
import { isNewer } from './update-check.js';

describe('isNewer', () => {
  it('détecte une version plus récente', () => {
    expect(isNewer('0.5.0', '0.6.0')).toBe(true);
    expect(isNewer('0.5.0', '1.0.0')).toBe(true);
    expect(isNewer('0.5.0', '0.5.1')).toBe(true);
  });

  it('rejette identique ou plus ancien', () => {
    expect(isNewer('0.5.0', '0.5.0')).toBe(false);
    expect(isNewer('0.6.0', '0.5.9')).toBe(false);
    expect(isNewer('1.0.0', '0.99.99')).toBe(false);
  });

  it('compare numériquement, pas lexicalement', () => {
    expect(isNewer('0.9.0', '0.10.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(false);
  });
});
