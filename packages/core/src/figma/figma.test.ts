import { parseDtcg } from '../tokens/dtcg.js';
import { describe, expect, it } from 'vitest';
import { FigmaClient, type FetchLike } from './client.js';
import { compareTokens } from './compare.js';
import { normalizeFigmaVariables } from './normalize.js';
import type { FigmaVariablesMeta, FigmaVariablesResponse } from './types.js';

const META: FigmaVariablesMeta = {
  variableCollections: {
    col1: {
      id: 'col1',
      name: 'Theme',
      defaultModeId: 'm1',
      modes: [
        { modeId: 'm1', name: 'Light' },
        { modeId: 'm2', name: 'Dark' },
      ],
    },
  },
  variables: {
    v1: {
      id: 'v1',
      name: 'color/brand/primary',
      variableCollectionId: 'col1',
      resolvedType: 'COLOR',
      valuesByMode: {
        m1: { r: 0.231, g: 0.51, b: 0.965, a: 1 },
        m2: { r: 0, g: 0, b: 0, a: 1 },
      },
    },
    v2: {
      id: 'v2',
      name: 'color/brand/primaryAlias',
      variableCollectionId: 'col1',
      resolvedType: 'COLOR',
      valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'v1' } },
    },
    v3: {
      id: 'v3',
      name: 'space/sm',
      variableCollectionId: 'col1',
      resolvedType: 'FLOAT',
      valuesByMode: { m1: 8 },
    },
  },
};

describe('FigmaClient', () => {
  it('calls the local variables endpoint with the token header', async () => {
    let calledUrl = '';
    let calledHeaders: Record<string, string> | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      calledUrl = url;
      calledHeaders = init?.headers;
      const body: FigmaVariablesResponse = { status: 200, error: false, meta: META };
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    };
    const client = new FigmaClient({ token: 'tok_123', fetchImpl });
    const res = await client.getLocalVariables('FILEKEY');
    expect(calledUrl).toBe('https://api.figma.com/v1/files/FILEKEY/variables/local');
    expect(calledHeaders?.['X-Figma-Token']).toBe('tok_123');
    expect(Object.keys(res.meta.variables)).toHaveLength(3);
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'Forbidden',
    });
    const client = new FigmaClient({ token: 't', fetchImpl });
    await expect(client.getLocalVariables('k')).rejects.toThrow(/403/);
  });
});

describe('normalizeFigmaVariables', () => {
  it('converts colors to hex and floats to px in the default mode', () => {
    const { tokens } = normalizeFigmaVariables(META);
    const byPath = new Map(tokens.map((t) => [t.path, t.value]));
    expect(byPath.get('color.brand.primary')).toBe('#3b82f6');
    expect(byPath.get('space.sm')).toBe('8px');
  });

  it('resolves variable aliases', () => {
    const { tokens } = normalizeFigmaVariables(META);
    const alias = tokens.find((t) => t.path === 'color.brand.primaryAlias');
    expect(alias!.value).toBe('#3b82f6');
  });

  it('resolves values in a named mode', () => {
    const { tokens } = normalizeFigmaVariables(META, { mode: 'Dark' });
    const primary = tokens.find((t) => t.path === 'color.brand.primary');
    expect(primary!.value).toBe('#000000');
  });

  it('detects alias cycles without infinite looping', () => {
    const cyclic: FigmaVariablesMeta = {
      variableCollections: META.variableCollections,
      variables: {
        a: {
          id: 'a',
          name: 'color/a',
          variableCollectionId: 'col1',
          resolvedType: 'COLOR',
          valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'b' } },
        },
        b: {
          id: 'b',
          name: 'color/b',
          variableCollectionId: 'col1',
          resolvedType: 'COLOR',
          valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'a' } },
        },
      },
    };
    const { errors } = normalizeFigmaVariables(cyclic);
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
  });
});

describe('compareTokens', () => {
  const { tokens: figmaTokens } = normalizeFigmaVariables(META);

  it('matches identical values and flags mismatches and gaps', () => {
    const { tokens: codeTokens } = parseDtcg({
      color: {
        $type: 'color',
        brand: {
          primary: { $value: '#ff0000' }, // mismatch vs Figma #3b82f6
          primaryAlias: { $value: '#3b82f6' }, // match
          // color.brand... but no `extra` here
        },
      },
      space: {
        $type: 'dimension',
        sm: { $value: '0.5rem' }, // 8px â†’ match Figma 8px
        lg: { $value: '24px' }, // missing in Figma
      },
    });

    const cmp = compareTokens(figmaTokens, codeTokens);
    expect(cmp.mismatches.map((m) => m.path)).toContain('color.brand.primary');
    expect(cmp.matches.map((m) => m.path)).toEqual(
      expect.arrayContaining(['color.brand.primaryAlias', 'space.sm']),
    );
    expect(cmp.missingInFigma.map((m) => m.path)).toContain('space.lg');
    expect(cmp.summary.inSync).toBe(false);
  });

  it('compares across units (rem vs px) as equal', () => {
    const { tokens: codeTokens } = parseDtcg({
      space: { $type: 'dimension', sm: { $value: '0.5rem' } },
    });
    const cmp = compareTokens(
      figmaTokens.filter((t) => t.path === 'space.sm'),
      codeTokens,
    );
    expect(cmp.summary.matched).toBe(1);
    expect(cmp.summary.mismatched).toBe(0);
  });
});
