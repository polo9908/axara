import { describe, expect, it } from 'vitest';
import { MODEL_CHOICES, progressLabel } from './fix-all.js';
import { CLAUDE_MODEL } from '../services/claude.js';
import { findCommand } from './help.js';
import { filterCommands } from '../ui/palette.js';

describe('MODEL_CHOICES', () => {
  it('propose le modèle par défaut de fix --ai en premier', () => {
    expect(MODEL_CHOICES[0]?.value).toBe(CLAUDE_MODEL);
  });

  it('chaque choix a une valeur et un libellé', () => {
    for (const choice of MODEL_CHOICES) {
      expect(choice.value.length).toBeGreaterThan(0);
      expect(choice.label.length).toBeGreaterThan(0);
    }
  });
});

describe('progressLabel', () => {
  it('rend le compteur x/N', () => {
    expect(progressLabel(4, 48)).toContain('4/48');
  });

  it('ajoute le fichier courant quand fourni', () => {
    const label = progressLabel(4, 48, 'src/Header.tsx');
    expect(label).toContain('4/48');
    expect(label).toContain('src/Header.tsx');
  });
});

describe('catalogue & palette', () => {
  it('fix-all est déclaré dans le catalogue', () => {
    const spec = findCommand('fix-all');
    expect(spec).toBeDefined();
    expect(spec?.usage).toContain('fix-all');
  });

  it('la palette trouve fix-all par mot-clé', () => {
    expect(filterCommands('tout').some((c) => c.name === 'fix-all')).toBe(true);
    expect(filterCommands('fix-all')[0]?.name).toBe('fix-all');
  });
});
