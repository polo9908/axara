/**
 * Tool: `validate_component_code`.
 * Normalizes a React/Vue/HTML snippet to HTML, runs the RGAA (axe-core) audit on
 * its structure, optionally checks design-token drift, and returns a verdict plus
 * an Ara-compatible declaration.
 */

import {
  analyzeSource,
  auditHtmlRgaa,
  toAraDeclaration,
  PAGE_SCOPED_RULES,
  type AraDeclaration,
  type DriftIssue,
  type RgaaReport,
} from '@axaraaudit/core';
import { toHtml, type Framework } from '../normalize.js';
import { resolveTokensPath, loadTokens } from '../tokens-source.js';

/** Validation scope: a `component` fragment vs a full `page`. */
export type ValidationScope = 'component' | 'page';

export interface ValidateComponentCodeInput {
  readonly code: string;
  readonly framework?: Framework | undefined;
  readonly tokensPath?: string | undefined;
  /** Also run design-token drift detection (React only). Default: true. */
  readonly checkDrift?: boolean | undefined;
  /**
   * `component` (default) disables page-level RGAA rules (heading-one,
   * landmarks, skip-linkâ€¦) that don't apply to an isolated fragment.
   */
  readonly scope?: ValidationScope | undefined;
}

export interface ValidateVerdict {
  readonly conformant: boolean;
  readonly rgaaCriteriaFailed: number;
  readonly rgaaCriteriaToReview: number;
  readonly driftErrors: number;
  readonly driftWarnings: number;
}

export interface ValidateComponentCodeResult {
  readonly framework: Exclude<Framework, 'auto'>;
  readonly scope: ValidationScope;
  readonly normalizedHtml: string;
  readonly verdict: ValidateVerdict;
  readonly rgaa: RgaaReport;
  readonly ara: AraDeclaration;
  readonly drift: readonly DriftIssue[];
  readonly notes: readonly string[];
}

export async function validateComponentCode(
  input: ValidateComponentCodeInput,
): Promise<ValidateComponentCodeResult> {
  const notes: string[] = [];
  const { html, framework } = toHtml(input.code, input.framework ?? 'auto');

  if (html.trim().length === 0) {
    notes.push('Aucun balisage exploitable dÃ©tectÃ© dans le snippet.');
  }

  // Structural RGAA audit via axe-core (contrast excluded â€” needs real layout).
  const scope = input.scope ?? 'component';
  const rgaa = await auditHtmlRgaa(
    html,
    scope === 'component' ? { disableRules: PAGE_SCOPED_RULES } : {},
  );
  const ara = toAraDeclaration(rgaa);

  // Design-token drift (React snippets only: needs JSX/TSX source).
  let drift: DriftIssue[] = [];
  const checkDrift = input.checkDrift ?? true;
  if (checkDrift) {
    if (framework === 'react') {
      const tokensPath = resolveTokensPath(
        input.tokensPath !== undefined ? { tokensPath: input.tokensPath } : {},
      );
      if (tokensPath) {
        const tokens = loadTokens(input.tokensPath !== undefined ? { tokensPath: input.tokensPath } : {});
        drift = analyzeSource({ path: 'snippet.tsx', content: input.code }, tokens.index);
      } else {
        notes.push('Drift non vÃ©rifiÃ© : aucun fichier de tokens DTCG trouvÃ© (voir get_design_system_rules).');
      }
    } else {
      notes.push(`Drift non vÃ©rifiÃ© : dÃ©tection limitÃ©e aux snippets React (framework dÃ©tectÃ© : ${framework}).`);
    }
  }

  const driftErrors = drift.filter((d) => d.severity === 'error').length;
  const driftWarnings = drift.filter((d) => d.severity === 'warning').length;
  const verdict: ValidateVerdict = {
    conformant: rgaa.summary.criteriaFailed === 0 && driftErrors === 0,
    rgaaCriteriaFailed: rgaa.summary.criteriaFailed,
    rgaaCriteriaToReview: rgaa.summary.criteriaToReview,
    driftErrors,
    driftWarnings,
  };

  return { framework, scope, normalizedHtml: html, verdict, rgaa, ara, drift, notes };
}
