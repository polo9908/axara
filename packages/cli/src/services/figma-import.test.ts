import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@axaraaudit/core';
import { importFigmaTokens, parseFigmaRef } from './figma-import.js';

describe('parseFigmaRef', () => {
  it('extrait la clé des URLs file/ et design/', () => {
    expect(parseFigmaRef('https://www.figma.com/design/aBc123XyZ/Mon-DS?node-id=1')).toBe(
      'aBc123XyZ',
    );
    expect(parseFigmaRef('https://figma.com/file/K3y456/Projet')).toBe('K3y456');
  });

  it('accepte une clé brute', () => {
    expect(parseFigmaRef('aBc123XyZ')).toBe('aBc123XyZ');
  });

  it('rejette le vide et le bruit', () => {
    expect(parseFigmaRef('')).toBeNull();
    expect(parseFigmaRef('   ')).toBeNull();
    expect(parseFigmaRef('pas une clé !')).toBeNull();
    expect(parseFigmaRef('https://example.com/file/abc')).toBeNull();
  });
});

const fakeResponse = (status: number, body: unknown): ReturnType<FetchLike> =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });

const META = {
  variableCollections: {
    col1: { id: 'col1', name: 'Theme', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }] },
  },
  variables: {
    v1: {
      id: 'v1',
      name: 'color/brand',
      variableCollectionId: 'col1',
      resolvedType: 'COLOR',
      valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
    },
  },
};

describe('importFigmaTokens', () => {
  it('convertit les variables en document DTCG plat', async () => {
    const result = await importFigmaTokens({
      fileKey: 'k',
      token: 't',
      fetchImpl: () => fakeResponse(200, { meta: META }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(1);
      expect(result.document['color-brand']).toEqual({ $type: 'color', $value: '#ffffff' });
    }
  });

  it('explique le 403 (API Variables = Enterprise)', async () => {
    const result = await importFigmaTokens({
      fileKey: 'k',
      token: 't',
      fetchImpl: () => fakeResponse(403, { error: true }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Enterprise/);
  });

  it('explique le 404 (clé erronée)', async () => {
    const result = await importFigmaTokens({
      fileKey: 'k',
      token: 't',
      fetchImpl: () => fakeResponse(404, {}),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/404/);
  });

  it('explique le timeout', async () => {
    const result = await importFigmaTokens({
      fileKey: 'k',
      token: 't',
      fetchImpl: () => Promise.reject(new Error('The operation was aborted due to timeout')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/délai|timed out/i);
  });
});
