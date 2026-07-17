import { describe, expect, it } from 'vitest';
import { figmaTokensToDtcg } from './figma-dtcg.js';
import { parseDtcg } from './dtcg.js';
import type { NormalizedFigmaToken } from '../figma/types.js';

const token = (path: string, value = '#112233'): NormalizedFigmaToken => ({
  path,
  type: 'color',
  value,
  figmaId: `id-${path}`,
  figmaName: path.replaceAll('.', '/'),
  mode: 'm1',
});

describe('figmaTokensToDtcg', () => {
  it('aplati les chemins pointés en clés à tirets (round-trip var())', () => {
    const { document, count } = figmaTokensToDtcg([token('color.brand.primary')]);
    expect(count).toBe(1);
    expect(document['color-brand-primary']).toEqual({ $type: 'color', $value: '#112233' });
    const parsed = parseDtcg(document);
    expect(parsed.tokens[0]?.path).toBe('color-brand-primary');
  });

  it('normalise casse, espaces et caractères spéciaux', () => {
    const { document } = figmaTokensToDtcg([token('color.Brand/Primary 2')]);
    expect(Object.keys(document)).toContain('color-brand-primary-2');
  });

  it('mentionne le mode dans la description', () => {
    const { document } = figmaTokensToDtcg([], { mode: 'Dark' });
    expect(document['$description']).toContain('Dark');
  });

  it('signale les doublons après aplatissement — le dernier gagne', () => {
    const result = figmaTokensToDtcg([
      token('color.primary', '#111111'),
      token('color/primary', '#222222'),
    ]);
    expect(result.count).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.document['color-primary']).toEqual({ $type: 'color', $value: '#222222' });
  });

  it('convertit les dimensions', () => {
    const dim: NormalizedFigmaToken = { ...token('spacing.sm'), type: 'dimension', value: '8px' };
    const { document } = figmaTokensToDtcg([dim]);
    expect(document['spacing-sm']).toEqual({ $type: 'dimension', $value: '8px' });
  });
});
