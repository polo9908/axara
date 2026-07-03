/** Public API of @axaraaudit/core. */

// Types
export type {
  TokenCategory,
  DesignToken,
  DriftSeverity,
  DriftMatchKind,
  DriftSuggestion,
  DriftIssue,
} from './types.js';

// Color
export {
  parseColor,
  isColor,
  toHex,
  colorDistance,
  type Rgb,
} from './color/color.js';

// Dimension
export {
  parseDimension,
  isDimension,
  dimensionDistance,
  DEFAULT_REM_BASE_PX,
  type Dimension,
} from './dimension/dimension.js';

// DTCG tokens
export {
  parseDtcg,
  parseDtcgString,
  TokenIndex,
  type DtcgParseResult,
  type ParseDtcgOptions,
  type ColorMatch,
  type DimensionMatch,
} from './tokens/dtcg.js';

// Zero-config token extraction from CSS custom properties
export {
  extractCssVarTokens,
  type CssSource,
  type CssVarExtraction,
  type ExtractCssVarOptions,
} from './tokens/css-vars.js';

// Analyzers
export { analyzeCss, isSpacingProperty, type CssAnalyzeOptions } from './analyzer/css.js';
export { analyzeTsx, type TsxAnalyzeOptions } from './analyzer/tsx.js';
export { jsxToHtml } from './analyzer/jsx-to-html.js';
export {
  evaluateColor,
  evaluateDimension,
  type LiteralOccurrence,
} from './analyzer/evaluate.js';
export { extractColors, extractDimensions, type Occurrence } from './analyzer/extract.js';

// Orchestration
export {
  analyzeSource,
  auditSources,
  auditPaths,
  type AuditReport,
  type AuditSummary,
  type SourceFile,
  type AuditOptions,
} from './analyzer/audit.js';

// Auto-fix (safe, position-based remediation)
export {
  applyFixes,
  fixFile,
  type AppliedFix,
  type FixResult,
  type ApplyFixesOptions,
  type FixFileResult,
  type FixFileOptions,
} from './fix/apply.js';

// RGAA (axe-core wrapper, mapping & DINUM/Ara export)
export {
  RGAA_VERSION,
  THEME_LABELS,
  CRITERIA,
  getCriterion,
  type RgaaCriterion,
} from './rgaa/criteria.js';
export { AXE_RGAA_MAP, criteriaForRule } from './rgaa/mapping.js';
export {
  mapAxeResults,
  type MapOptions,
} from './rgaa/map.js';
export type {
  AxeImpact,
  RgaaStatus,
  RgaaOccurrence,
  RgaaFinding,
  RgaaSummary,
  RgaaReport,
} from './rgaa/types.js';
export {
  toAraDeclaration,
  type AraStatus,
  type AraUserImpact,
  type AraCriterionResult,
  type AraDeclaration,
  type ToAraOptions,
} from './rgaa/ara.js';
export {
  runAxeOnHtml,
  auditHtmlRgaa,
  DEFAULT_AXE_TAGS,
  PAGE_SCOPED_RULES,
  type RunAxeOptions,
  type AuditHtmlOptions,
} from './rgaa/runner.js';
