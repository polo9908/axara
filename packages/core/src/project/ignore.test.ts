import { describe, expect, it } from 'vitest';
import {
  driftDirectiveMatches,
  globToRegExp,
  matchesAnyGlob,
  parseIgnoreRule,
  parseInlineDirectives,
  rgaaDirectiveMatches,
} from './ignore.js';

describe('parseInlineDirectives', () => {
  it('détecte les trois formes de commentaire (JSX, bloc, HTML)', () => {
    const source = [
      '// axara-ignore: RGAA-3.2 raison="décoratif, alt vide voulu"',
      '<img src="deco.png" alt="" />',
      '{/* axara-ignore: color reason="couleur marketing hors DS" */}',
      '<div style={{ color: "#ff00aa" }} />',
      '/* axara-ignore: drift raison="fichier legacy" */',
      '<!-- axara-ignore: RGAA-1.1 raison="illustration" -->',
    ].join('\n');
    const { directives, invalid } = parseInlineDirectives(source);
    expect(invalid).toHaveLength(0);
    expect(directives.map((d) => [d.line, d.rawRule, d.reason])).toEqual([
      [1, 'RGAA-3.2', 'décoratif, alt vide voulu'],
      [3, 'color', 'couleur marketing hors DS'],
      [5, 'drift', 'fichier legacy'],
      [6, 'RGAA-1.1', 'illustration'],
    ]);
  });

  it("sans raison : directive invalide, jamais appliquée — pas d'ignore silencieux", () => {
    const { directives, invalid } = parseInlineDirectives(
      '// axara-ignore: RGAA-3.2\n// axara-ignore: color raison=""\n',
    );
    expect(directives).toHaveLength(0);
    expect(invalid).toEqual([
      { line: 1, rule: 'RGAA-3.2' },
      { line: 2, rule: 'color' },
    ]);
  });

  it('accepte raison= et reason= indifféremment', () => {
    const { directives } = parseInlineDirectives(
      '// axara-ignore: 3.2 reason="in English"\n// axara-ignore: 3.3 raison="en français"\n',
    );
    expect(directives.map((d) => d.reason)).toEqual(['in English', 'en français']);
  });
});

describe('parseIgnoreRule', () => {
  it('normalise les critères RGAA sous leurs trois écritures', () => {
    expect(parseIgnoreRule('RGAA-3.2')).toEqual({ kind: 'rgaa', criterion: '3.2' });
    expect(parseIgnoreRule('rgaa-11.1')).toEqual({ kind: 'rgaa', criterion: '11.1' });
    expect(parseIgnoreRule('3.2')).toEqual({ kind: 'rgaa', criterion: '3.2' });
  });

  it('drift générique, catégorie ou propriété', () => {
    expect(parseIgnoreRule('drift')).toEqual({ kind: 'drift', target: '*' });
    expect(parseIgnoreRule('color')).toEqual({ kind: 'drift', target: 'color' });
    expect(parseIgnoreRule('background-color')).toEqual({ kind: 'drift', target: 'background-color' });
  });
});

describe('portées', () => {
  const directive = (line: number, rule: string) => {
    const { directives } = parseInlineDirectives(
      `${'\n'.repeat(line - 1)}// axara-ignore: ${rule} raison="x"`,
    );
    return directives[0]!;
  };

  it('drift : ligne du commentaire (fin de ligne) et ligne suivante', () => {
    const d = directive(5, 'color');
    const issue = { category: 'color', property: 'background-color' };
    expect(driftDirectiveMatches(d, { ...issue, line: 5 })).toBe(true);
    expect(driftDirectiveMatches(d, { ...issue, line: 6 })).toBe(true);
    expect(driftDirectiveMatches(d, { ...issue, line: 7 })).toBe(false);
    expect(driftDirectiveMatches(d, { ...issue, line: 4 })).toBe(false);
  });

  it('drift : la cible filtre par catégorie ou propriété', () => {
    const color = directive(1, 'color');
    expect(driftDirectiveMatches(color, { line: 2, category: 'dimension', property: 'margin' })).toBe(false);
    const property = directive(1, 'margin');
    expect(driftDirectiveMatches(property, { line: 2, category: 'dimension', property: 'margin' })).toBe(true);
    const any = directive(1, 'drift');
    expect(driftDirectiveMatches(any, { line: 2, category: 'dimension', property: 'margin' })).toBe(true);
  });

  it('rgaa : critère exact, fichier entier (pas de ligne)', () => {
    const d = directive(1, 'RGAA-3.2');
    expect(rgaaDirectiveMatches(d, { criterion: '3.2' })).toBe(true);
    expect(rgaaDirectiveMatches(d, { criterion: '3.3' })).toBe(false);
  });
});

describe('globs', () => {
  it('** traverse les dossiers, * reste dans un segment', () => {
    expect(globToRegExp('src/legacy/**').test('src/legacy/deep/a.tsx')).toBe(true);
    expect(globToRegExp('src/*.css').test('src/a.css')).toBe(true);
    expect(globToRegExp('src/*.css').test('src/deep/a.css')).toBe(false);
    expect(matchesAnyGlob('src/x.tsx', ['lib/**', 'src/**'])).toBe(true);
    expect(matchesAnyGlob('other/x.tsx', ['lib/**', 'src/**'])).toBe(false);
  });
});
