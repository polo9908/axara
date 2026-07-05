import { describe, expect, it } from 'vitest';
import { simulateScreenReader } from './voice.js';

function utterances(html: string): string[] {
  return simulateScreenReader(html).map((a) => a.utterance);
}

describe('simulateScreenReader', () => {
  it('announces headings with their level', () => {
    expect(utterances('<h2>Tarifs</h2>')).toEqual(['titre de niveau 2 : Tarifs']);
  });

  it('announces named links and warns on empty ones', () => {
    const result = simulateScreenReader('<a href="/">Accueil</a><a href="/contact"></a>');
    expect(result[0]).toMatchObject({ utterance: 'lien : Accueil' });
    expect(result[1]).toMatchObject({
      utterance: 'lien',
      warning: { criterion: '6.1' },
    });
  });

  it('warns on images without alt, stays silent on decorative alt=""', () => {
    const result = simulateScreenReader('<img src="a.png"><img src="b.png" alt=""><img src="c.png" alt="Logo">');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ utterance: 'image', warning: { criterion: '1.1' } });
    expect(result[1]).toMatchObject({ utterance: 'image : Logo' });
  });

  it('warns on placeholder-only fields and resolves label[for]', () => {
    const html = `
      <label for="mail">Votre e-mail</label><input id="mail" type="email">
      <input type="text" placeholder="Votre nom">
    `;
    const result = simulateScreenReader(html);
    expect(result[0]).toMatchObject({ utterance: 'champ de saisie e-mail : Votre e-mail' });
    expect(result[1]).toMatchObject({ warning: { criterion: '11.1' } });
    expect(result[1]?.warning?.message).toContain('Votre nom');
  });

  it('announces buttons, with aria-label taking precedence', () => {
    const result = simulateScreenReader('<button aria-label="Fermer la fenêtre">×</button><button></button>');
    expect(result[0]).toMatchObject({ utterance: 'bouton : Fermer la fenêtre' });
    expect(result[1]).toMatchObject({ utterance: 'bouton', warning: { criterion: '11.9' } });
  });

  it('announces landmarks and lists, and skips aria-hidden content', () => {
    const html = `
      <nav aria-label="Navigation principale">
        <ul><li><a href="/">Accueil</a></li><li><a href="/prix">Prix</a></li></ul>
      </nav>
      <div aria-hidden="true"><a href="/secret">Caché</a></div>
    `;
    const result = utterances(html);
    expect(result).toEqual([
      'région : navigation — Navigation principale',
      'liste de 2 éléments',
      'lien : Accueil',
      'lien : Prix',
    ]);
  });

  it('reads paragraph text truncated and surfaces links inside', () => {
    const long = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore.';
    const result = simulateScreenReader(`<p>${long} <a href="/plus">En savoir plus</a></p>`);
    expect(result[0]?.utterance.endsWith('…')).toBe(true);
    expect(result[1]).toMatchObject({ utterance: 'lien : En savoir plus' });
  });
});
