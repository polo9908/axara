/**
 * RGAA 4.1 reference data: the 13 themes and metadata for the criteria we map
 * automated axe-core checks onto.
 *
 * Only a subset of the 106 RGAA criteria can be evaluated automatically; we keep
 * rich metadata for those and synthesize a sane fallback (`getCriterion`) for any
 * criterion id that lacks an explicit entry, so the mapping table can grow
 * without ever producing an "unknown criterion".
 */

export interface RgaaCriterion {
  /** Criterion id, e.g. `"1.1"`. */
  readonly id: string;
  /** RGAA theme number, 1–13. */
  readonly theme: number;
  /** French theme label. */
  readonly themeLabel: string;
  /** French criterion wording (question form, as in the RGAA). */
  readonly title: string;
  /** Referenced WCAG 2.1 success criteria. */
  readonly wcag: readonly string[];
}

export const RGAA_VERSION = '4.1' as const;

/** The 13 RGAA themes. */
export const THEME_LABELS: Readonly<Record<number, string>> = {
  1: 'Images',
  2: 'Cadres',
  3: 'Couleurs',
  4: 'Multimédia',
  5: 'Tableaux',
  6: 'Liens',
  7: 'Scripts',
  8: 'Éléments obligatoires',
  9: "Structuration de l'information",
  10: "Présentation de l'information",
  11: 'Formulaires',
  12: 'Navigation',
  13: 'Consultation',
};

const C = (
  id: string,
  theme: number,
  title: string,
  wcag: readonly string[],
): readonly [string, RgaaCriterion] => [
  id,
  { id, theme, themeLabel: THEME_LABELS[theme] ?? `Thème ${theme}`, title, wcag },
];

/** Rich metadata for the criteria reachable from the axe→RGAA mapping. */
export const CRITERIA: ReadonlyMap<string, RgaaCriterion> = new Map([
  C('1.1', 1, 'Chaque image porteuse d’information a-t-elle une alternative textuelle ?', ['1.1.1']),
  C('1.2', 1, 'Chaque image de décoration est-elle correctement ignorée par les technologies d’assistance ?', ['1.1.1']),
  C('2.1', 2, 'Chaque cadre a-t-il un titre de cadre ?', ['4.1.2', '2.4.1']),
  C('2.2', 2, 'Pour chaque cadre ayant un titre de cadre, ce titre de cadre est-il pertinent ?', ['2.4.1']),
  C('3.2', 3, 'Dans chaque page web, le contraste entre la couleur du texte et la couleur de son arrière-plan est-il suffisamment élevé ?', ['1.4.3']),
  C('3.3', 3, 'Dans chaque page web, les couleurs utilisées dans les composants d’interface ou les éléments graphiques porteurs d’informations sont-elles suffisamment contrastées ?', ['1.4.11']),
  C('4.1', 4, 'Chaque média temporel pré-enregistré a-t-il, si nécessaire, une transcription textuelle ou une audiodescription ?', ['1.2.1', '1.2.2', '1.2.3']),
  C('5.4', 5, 'Pour chaque tableau de données ayant un titre, le titre est-il correctement associé au tableau de données ?', ['1.3.1']),
  C('5.6', 5, 'Pour chaque tableau de données, chaque en-tête de colonnes et chaque en-tête de lignes sont-ils correctement déclarés ?', ['1.3.1']),
  C('5.7', 5, 'Pour chaque tableau de données, la technique appropriée permettant d’associer chaque cellule avec ses en-têtes est-elle utilisée ?', ['1.3.1']),
  C('6.1', 6, 'Chaque lien est-il explicite (hors cas particuliers) ?', ['2.4.4', '2.4.9']),
  C('7.1', 7, 'Chaque script est-il, si nécessaire, compatible avec les technologies d’assistance ?', ['4.1.2']),
  C('7.3', 7, 'Chaque script est-il contrôlable par le clavier et par tout dispositif de pointage (hors cas particuliers) ?', ['2.1.1']),
  C('8.2', 8, 'Pour chaque page web, le code source généré est-il valide selon le type de document spécifié ?', ['4.1.1']),
  C('8.3', 8, 'Dans chaque page web, la langue par défaut est-elle présente ?', ['3.1.1']),
  C('8.4', 8, 'Pour chaque page web ayant une langue par défaut, le code de langue est-il pertinent ?', ['3.1.1']),
  C('8.5', 8, 'Chaque page web a-t-elle un titre de page ?', ['2.4.2']),
  C('8.7', 8, 'Dans chaque page web, chaque changement de langue est-il indiqué dans le code source (hors cas particuliers) ?', ['3.1.2']),
  C('9.1', 9, 'Dans chaque page web, l’information est-elle structurée par l’utilisation appropriée de titres ?', ['1.3.1', '2.4.1']),
  C('9.3', 9, 'Dans chaque page web, chaque liste est-elle correctement structurée ?', ['1.3.1']),
  C('10.4', 10, 'Dans chaque page web, le texte reste-t-il lisible lorsque la taille des caractères est augmentée jusqu’à 200 %, au moins ?', ['1.4.4']),
  C('11.1', 11, 'Chaque champ de formulaire a-t-il une étiquette ?', ['1.3.1', '3.3.2', '4.1.2']),
  C('11.2', 11, 'Chaque étiquette associée à un champ de formulaire est-elle pertinente ?', ['1.3.1', '2.4.6']),
  C('11.9', 11, 'Dans chaque formulaire, l’intitulé de chaque bouton est-il pertinent ?', ['4.1.2', '2.4.6']),
  C('11.13', 11, 'La finalité d’un champ de saisie peut-elle être déduite pour faciliter le remplissage automatique des champs ?', ['1.3.5']),
  C('12.6', 12, 'Les zones de regroupement de contenus présentes dans plusieurs pages web peuvent-elles être atteintes ou évitées ?', ['2.4.1']),
  C('12.8', 12, 'Dans chaque page web, l’ordre de tabulation est-il cohérent ?', ['2.4.3']),
  C('12.10', 12, 'Dans chaque page web, les raccourcis clavier n’utilisant qu’une seule touche sont-ils contrôlables par l’utilisateur ?', ['2.1.4']),
  C('13.8', 13, 'Dans chaque page web, chaque contenu en mouvement ou clignotant est-il contrôlable par l’utilisateur ?', ['2.2.2']),
]);

/** Metadata for a criterion id, synthesizing a fallback when not curated. */
export function getCriterion(id: string): RgaaCriterion {
  const known = CRITERIA.get(id);
  if (known) return known;
  const theme = Number.parseInt(id.split('.')[0] ?? '0', 10);
  return {
    id,
    theme,
    themeLabel: THEME_LABELS[theme] ?? `Thème ${theme}`,
    title: `Critère RGAA ${id}`,
    wcag: [],
  };
}
