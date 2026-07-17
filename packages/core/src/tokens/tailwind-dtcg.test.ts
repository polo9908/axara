import { describe, expect, it } from 'vitest';
import { tailwindThemeToDtcg } from './tailwind-dtcg.js';
import { parseDtcg } from './dtcg.js';

describe('tailwindThemeToDtcg', () => {
  it('aplati les couleurs imbriquées avec le préfixe color-', () => {
    const { document, count } = tailwindThemeToDtcg({
      colors: { primary: { 50: '#eff6ff', 500: '#3b82f6' }, white: '#ffffff' },
    });
    expect(count).toBe(3);
    expect(document['color-primary-50']).toEqual({ $type: 'color', $value: '#eff6ff' });
    expect(document['color-white']).toEqual({ $type: 'color', $value: '#ffffff' });
    expect(parseDtcg(document).tokens).toHaveLength(3);
  });

  it('supprime le segment DEFAULT', () => {
    const { document } = tailwindThemeToDtcg({
      colors: { primary: { DEFAULT: '#3b82f6', dark: '#1e40af' } },
    });
    expect(document['color-primary']).toEqual({ $type: 'color', $value: '#3b82f6' });
    expect(document['color-primary-dark']).toBeDefined();
  });

  it('extend écrase la base, section par section', () => {
    const { document } = tailwindThemeToDtcg({
      colors: { brand: '#111111' },
      extend: { colors: { brand: '#222222', extra: '#333333' } },
    });
    expect(document['color-brand']).toEqual({ $type: 'color', $value: '#222222' });
    expect(document['color-extra']).toBeDefined();
  });

  it('couvre spacing, borderRadius, fontSize et lineHeight en dimensions', () => {
    const { document } = tailwindThemeToDtcg({
      spacing: { 4: '1rem' },
      borderRadius: { lg: '0.5rem' },
      fontSize: { base: ['1rem', { lineHeight: '1.5rem' }] },
      lineHeight: { tight: '1.25rem' },
    });
    expect(document['spacing-4']).toEqual({ $type: 'dimension', $value: '1rem' });
    expect(document['radius-lg']).toEqual({ $type: 'dimension', $value: '0.5rem' });
    expect(document['font-size-base']).toEqual({ $type: 'dimension', $value: '1rem' });
    expect(document['line-height-tight']).toEqual({ $type: 'dimension', $value: '1.25rem' });
  });

  it('saute fonctions et valeurs invalides avec un warning', () => {
    const { document, count, warnings } = tailwindThemeToDtcg({
      colors: {
        fn: (() => '#fff') as unknown,
        current: 'currentColor',
        ok: '#123456',
      },
    });
    expect(count).toBe(1);
    expect(document['color-ok']).toBeDefined();
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('thème vide ou non-objet → count 0', () => {
    expect(tailwindThemeToDtcg({}).count).toBe(0);
    expect(tailwindThemeToDtcg(null).count).toBe(0);
    expect(tailwindThemeToDtcg(null).warnings).toHaveLength(1);
  });
});
