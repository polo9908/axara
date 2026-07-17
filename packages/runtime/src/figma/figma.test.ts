/**
 * Smoke test : le connecteur Figma a déménagé dans core ; runtime doit
 * continuer d'exposer les mêmes symboles (compatibilité descendante).
 * La suite complète vit dans core/src/figma/figma.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { FigmaClient } from './client.js';
import { compareTokens } from './compare.js';
import { normalizeFigmaVariables } from './normalize.js';

describe('figma re-exports (back-compat)', () => {
  it('expose FigmaClient, normalizeFigmaVariables et compareTokens', () => {
    expect(typeof FigmaClient).toBe('function');
    expect(typeof normalizeFigmaVariables).toBe('function');
    expect(typeof compareTokens).toBe('function');
  });

  it('FigmaClient exige toujours un jeton', () => {
    expect(() => new FigmaClient({ token: '' })).toThrow(/token/i);
  });
});
