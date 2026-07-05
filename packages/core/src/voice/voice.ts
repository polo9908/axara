/**
 * Screen-reader simulation.
 *
 * Walks the DOM in reading order and produces, for each element a screen
 * reader would stop on, the utterance a French screen reader (NVDA/VoiceOver)
 * would plausibly announce — plus an RGAA warning whenever the announcement
 * is degraded (unnamed link, missing alt, unlabeled field…).
 *
 * This is intentionally a *simulation* built on a simplified accessible-name
 * computation: good enough to make the developer HEAR the problem, not a
 * replacement for testing with a real screen reader.
 */

import { JSDOM } from 'jsdom';

export interface VoiceWarning {
  /** RGAA criterion, e.g. `1.1`. */
  readonly criterion: string;
  readonly message: string;
}

export interface VoiceAnnouncement {
  /** What the screen reader says, e.g. `lien : Accueil`. */
  readonly utterance: string;
  readonly kind: 'region' | 'structure' | 'interactive' | 'text';
  readonly warning?: VoiceWarning;
}

const TEXT_TRUNCATE = 80;
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD']);

function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string): string {
  return text.length > TEXT_TRUNCATE ? `${text.slice(0, TEXT_TRUNCATE)}…` : text;
}

/** Simplified accessible-name computation (aria-label > labelledby > content). */
function accessibleName(el: Element): string {
  const ariaLabel = collapse(el.getAttribute('aria-label'));
  if (ariaLabel !== '') return ariaLabel;

  const labelledBy = collapse(el.getAttribute('aria-labelledby'));
  if (labelledBy !== '') {
    const doc = el.ownerDocument;
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => collapse(doc.getElementById(id)?.textContent))
      .filter((part) => part !== '');
    if (parts.length > 0) return parts.join(' ');
  }

  const content = collapse(el.textContent);
  if (content !== '') return content;

  return collapse(el.getAttribute('title'));
}

/** Label of a form field: <label for>, wrapping <label>, aria-*. */
function fieldLabel(el: Element): string {
  const aria = collapse(el.getAttribute('aria-label'));
  if (aria !== '') return aria;
  const labelledBy = collapse(el.getAttribute('aria-labelledby'));
  if (labelledBy !== '') {
    const byId = accessibleName(el);
    if (byId !== '') return byId;
  }
  const id = el.getAttribute('id');
  if (id !== null && id !== '') {
    const label = el.ownerDocument.querySelector(`label[for="${id}"]`);
    const text = collapse(label?.textContent);
    if (text !== '') return text;
  }
  const wrapping = el.closest('label');
  if (wrapping !== null) {
    const text = collapse(wrapping.textContent);
    if (text !== '') return text;
  }
  return '';
}

const INPUT_KIND: Record<string, string> = {
  text: 'champ de saisie',
  email: 'champ de saisie e-mail',
  password: 'champ de mot de passe',
  search: 'champ de recherche',
  tel: 'champ de téléphone',
  number: 'champ numérique',
  checkbox: 'case à cocher',
  radio: 'bouton radio',
  submit: 'bouton',
  button: 'bouton',
  file: 'sélecteur de fichier',
  date: 'champ de date',
};

const REGION_LABEL: Record<string, string> = {
  NAV: 'navigation',
  MAIN: 'contenu principal',
  HEADER: 'en-tête',
  FOOTER: 'pied de page',
  ASIDE: 'contenu complémentaire',
  FORM: 'formulaire',
};

/** Simulate what a screen reader announces while reading `html` top-to-bottom. */
export function simulateScreenReader(html: string): VoiceAnnouncement[] {
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const out: VoiceAnnouncement[] = [];

  const visit = (el: Element): void => {
    if (SKIPPED_TAGS.has(el.tagName)) return;
    if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) return;
    const tag = el.tagName;

    // Headings
    if (/^H[1-6]$/.test(tag)) {
      const level = tag[1]!;
      const name = collapse(el.textContent);
      if (name === '') {
        out.push({
          utterance: `titre de niveau ${level}`,
          kind: 'structure',
          warning: { criterion: '9.1', message: 'titre vide — la structure annoncée est trompeuse' },
        });
      } else {
        out.push({ utterance: `titre de niveau ${level} : ${name}`, kind: 'structure' });
      }
      return;
    }

    // Links
    if (tag === 'A') {
      const name = accessibleName(el);
      if (name === '') {
        out.push({
          utterance: 'lien',
          kind: 'interactive',
          warning: {
            criterion: '6.1',
            message: 'lien sans intitulé — l’utilisateur entend seulement « lien », sans savoir où il mène',
          },
        });
      } else {
        out.push({ utterance: `lien : ${name}`, kind: 'interactive' });
      }
      return;
    }

    // Buttons
    if (tag === 'BUTTON' || (tag === 'INPUT' && ['submit', 'button'].includes(el.getAttribute('type') ?? ''))) {
      const name = tag === 'BUTTON' ? accessibleName(el) : collapse(el.getAttribute('value'));
      if (name === '') {
        out.push({
          utterance: 'bouton',
          kind: 'interactive',
          warning: {
            criterion: '11.9',
            message: 'bouton sans intitulé — impossible de savoir ce qu’il déclenche',
          },
        });
      } else {
        out.push({ utterance: `bouton : ${name}`, kind: 'interactive' });
      }
      return;
    }

    // Images
    if (tag === 'IMG') {
      const alt = el.getAttribute('alt');
      if (alt === null) {
        out.push({
          utterance: 'image',
          kind: 'interactive',
          warning: {
            criterion: '1.1',
            message: 'image sans alternative textuelle — le lecteur d’écran n’annonce que « image »',
          },
        });
      } else if (collapse(alt) !== '') {
        out.push({ utterance: `image : ${collapse(alt)}`, kind: 'interactive' });
      }
      // alt="" → decorative, silently skipped (correct behavior).
      return;
    }

    // Form fields
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const type = tag === 'INPUT' ? (el.getAttribute('type') ?? 'text') : tag.toLowerCase();
      const kindLabel =
        tag === 'TEXTAREA'
          ? 'zone de texte'
          : tag === 'SELECT'
            ? 'liste déroulante'
            : (INPUT_KIND[type] ?? 'champ de saisie');
      const label = fieldLabel(el);
      if (label === '') {
        const placeholder = collapse(el.getAttribute('placeholder'));
        out.push({
          utterance: kindLabel,
          kind: 'interactive',
          warning: {
            criterion: '11.1',
            message:
              placeholder !== ''
                ? `champ sans étiquette — le placeholder « ${placeholder} » n’est pas annoncé de façon fiable`
                : 'champ sans étiquette — l’utilisateur ne sait pas quoi saisir',
          },
        });
      } else {
        out.push({ utterance: `${kindLabel} : ${label}`, kind: 'interactive' });
      }
      return;
    }

    // Landmarks / regions
    const region = REGION_LABEL[tag];
    if (region !== undefined && (tag !== 'FORM' || accessibleName(el) !== collapse(el.textContent))) {
      const ariaLabel = collapse(el.getAttribute('aria-label'));
      out.push({
        utterance: `région : ${region}${ariaLabel !== '' ? ` — ${ariaLabel}` : ''}`,
        kind: 'region',
      });
      for (const child of el.children) visit(child);
      return;
    }

    // Lists
    if (tag === 'UL' || tag === 'OL') {
      const items = el.querySelectorAll(':scope > li').length;
      out.push({ utterance: `liste de ${items} élément${items > 1 ? 's' : ''}`, kind: 'structure' });
      for (const child of el.children) visit(child);
      return;
    }

    // Paragraph-level text
    if (tag === 'P') {
      const text = collapse(el.textContent);
      if (text !== '') out.push({ utterance: truncate(text), kind: 'text' });
      // Still surface interactive descendants (announced inline by real SRs).
      for (const inner of el.querySelectorAll('a, button, img, input, textarea, select')) {
        visit(inner);
      }
      return;
    }

    for (const child of el.children) visit(child);
  };

  for (const child of body.children) visit(child);
  return out;
}
