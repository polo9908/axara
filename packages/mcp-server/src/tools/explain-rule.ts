/**
 * Tool: `explain_rule`.
 * Returns the metadata of an RGAA 4.1 criterion (theme, wording, WCAG
 * references) plus the axe-core rules mapped onto it, so an agent can dig into
 * any violation reported by `audit_project` or `validate_component_code`.
 */

import { AXE_RGAA_MAP, CRITERIA, getCriterion, RGAA_VERSION, THEME_LABELS } from '@axaraaudit/core';
import { z } from 'zod';

export const EXPLAIN_RULE_INPUT = {
  criterion: z
    .string()
    .describe('Identifiant du critère RGAA, ex. "1.1", "11.1" — ou un thème entier, ex. "11".'),
};

export const EXPLAIN_RULE_OUTPUT = {
  rgaaVersion: z.string(),
  criteria: z.array(
    z.object({
      criterion: z.string(),
      documented: z.boolean().describe('false : critère hors du périmètre automatisable, métadonnées synthétisées.'),
      theme: z.number(),
      themeLabel: z.string(),
      title: z.string().describe('Intitulé officiel du critère (forme interrogative).'),
      wcag: z.array(z.string()).describe('Critères de succès WCAG 2.1 référencés.'),
      axeRules: z.array(z.string()).describe('Règles axe-core mappées sur ce critère.'),
    }),
  ),
  guidance: z.string(),
};

export interface ExplainRuleInput {
  readonly criterion: string;
}

function axeRulesFor(criterionId: string): string[] {
  const rules: string[] = [];
  for (const [rule, criteria] of Object.entries(AXE_RGAA_MAP)) {
    if (criteria.includes(criterionId)) rules.push(rule);
  }
  return rules.sort();
}

function describeCriterion(id: string) {
  const criterion = getCriterion(id);
  return {
    criterion: criterion.id,
    documented: CRITERIA.has(id),
    theme: criterion.theme,
    themeLabel: criterion.themeLabel,
    title: criterion.title,
    wcag: [...criterion.wcag],
    axeRules: axeRulesFor(id),
  };
}

export function runExplainRule(input: ExplainRuleInput) {
  const query = input.criterion.trim();

  // A bare theme number ("11") expands to every documented criterion of that theme.
  const themeNumber = /^\d{1,2}$/.test(query) ? Number(query) : null;
  if (themeNumber !== null && THEME_LABELS[themeNumber] !== undefined) {
    const criteria = [...CRITERIA.keys()]
      .filter((id) => id.startsWith(`${themeNumber}.`))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(describeCriterion);
    return {
      rgaaVersion: RGAA_VERSION,
      criteria,
      guidance: `Thème ${themeNumber} — ${THEME_LABELS[themeNumber]} : ${criteria.length} critère(s) couvert(s) par l'audit automatique.`,
    };
  }

  return {
    rgaaVersion: RGAA_VERSION,
    criteria: [describeCriterion(query)],
    guidance:
      'Référence complète : https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/ ' +
      '— l’audit automatique ne couvre qu’un sous-ensemble des 106 critères ; le reste demande une revue humaine.',
  };
}
