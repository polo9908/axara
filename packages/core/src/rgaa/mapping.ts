/**
 * Mapping from axe-core rule ids to RGAA 4.1 criteria.
 *
 * This is a best-effort, curated correspondence: axe rules carry WCAG tags and
 * RGAA criteria themselves reference WCAG success criteria, so most rules map
 * cleanly. A rule may legitimately map to several criteria. Rules with no entry
 * are surfaced as `unmappedRules` rather than silently dropped, so the table can
 * be audited and extended.
 */

export const AXE_RGAA_MAP: Readonly<Record<string, readonly string[]>> = {
  // 1 — Images / text alternatives
  'area-alt': ['1.1'],
  'image-alt': ['1.1'],
  'input-image-alt': ['1.1'],
  'object-alt': ['1.1'],
  'role-img-alt': ['1.1'],
  'svg-img-alt': ['1.1'],
  'image-redundant-alt': ['1.2'],
  'presentation-role-conflict': ['1.2'],

  // 2 — Frames
  'frame-title': ['2.1'],
  'frame-title-unique': ['2.2'],

  // 3 — Colors / contrast
  'color-contrast': ['3.2'],
  'color-contrast-enhanced': ['3.2'],
  'link-in-text-block': ['3.3'],

  // 4 — Multimedia
  'video-caption': ['4.1'],
  'audio-caption': ['4.1'],
  'no-autoplay-audio': ['4.1'],

  // 5 — Data tables
  'td-headers-attr': ['5.7'],
  'th-has-data-cells': ['5.6'],
  'td-has-header': ['5.7'],
  'scope-attr-valid': ['5.6'],
  'table-fake-caption': ['5.4'],
  'empty-table-header': ['5.6'],

  // 6 — Links
  'link-name': ['6.1'],
  'identical-links-same-purpose': ['6.1'],

  // 7 — Scripts / ARIA name-role-value
  'aria-allowed-attr': ['7.1'],
  'aria-allowed-role': ['7.1'],
  'aria-command-name': ['7.1'],
  'aria-meter-name': ['7.1'],
  'aria-progressbar-name': ['7.1'],
  'aria-required-attr': ['7.1'],
  'aria-required-children': ['7.1'],
  'aria-required-parent': ['7.1'],
  'aria-roles': ['7.1'],
  'aria-tooltip-name': ['7.1'],
  'aria-valid-attr': ['7.1'],
  'aria-valid-attr-value': ['7.1'],
  'aria-conditional-attr': ['7.1'],
  'aria-deprecated-role': ['7.1'],
  'aria-prohibited-attr': ['7.1'],
  'nested-interactive': ['7.1'],
  'aria-hidden-body': ['7.1'],
  'aria-hidden-focus': ['7.3'],
  'focus-order-semantics': ['7.3'],
  'scrollable-region-focusable': ['7.3'],

  // 8 — Mandatory elements
  'duplicate-id': ['8.2'],
  'duplicate-id-active': ['8.2'],
  'duplicate-id-aria': ['8.2'],
  'document-title': ['8.5'],
  'html-has-lang': ['8.3'],
  'html-lang-valid': ['8.4'],
  'html-xml-lang-mismatch': ['8.4'],
  'valid-lang': ['8.7'],

  // 9 — Structure
  'heading-order': ['9.1'],
  'empty-heading': ['9.1'],
  'page-has-heading-one': ['9.1'],
  'list': ['9.3'],
  'listitem': ['9.3'],
  'definition-list': ['9.3'],
  'dlitem': ['9.3'],

  // 10 — Presentation
  'meta-viewport': ['10.4'],
  'meta-viewport-large': ['10.4'],
  'css-orientation-lock': ['10.4'],

  // 11 — Forms
  'label': ['11.1'],
  'label-title-only': ['11.1'],
  'select-name': ['11.1'],
  'aria-input-field-name': ['11.1'],
  'aria-toggle-field-name': ['11.1'],
  'form-field-multiple-labels': ['11.2'],
  'button-name': ['11.9'],
  'input-button-name': ['11.9'],
  'autocomplete-valid': ['11.13'],

  // 12 — Navigation
  'bypass': ['12.6'],
  'skip-link': ['12.6'],
  'landmark-one-main': ['12.6'],
  'region': ['12.6'],
  'tabindex': ['12.8'],
  'accesskeys': ['12.10'],

  // 13 — Consultation
  'blink': ['13.8'],
  'marquee': ['13.8'],
  'meta-refresh': ['13.8'],
};

/** Criteria mapped from an axe rule id, or `null` when the rule is unmapped. */
export function criteriaForRule(ruleId: string): readonly string[] | null {
  return AXE_RGAA_MAP[ruleId] ?? null;
}
