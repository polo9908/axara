/** Public API of @axaraaudit/runtime. */

// Focus / keyboard-trap analysis
export { analyzeFocusOrder, type AnalyzeOptions } from './focus/trap.js';
export type {
  FocusSnapshot,
  FocusOrderReport,
  TrapKind,
} from './focus/types.js';

// Playwright headless focus audit
export {
  auditFocusOrder,
  ENTER_ID,
  EXIT_ID,
  type MountOptions,
  type FocusAudit,
} from './playwright/mount.js';

// Figma Variables connector
export { FigmaClient, type FigmaClientOptions, type FetchLike } from './figma/client.js';
export {
  normalizeFigmaVariables,
  type NormalizeOptions,
  type NormalizeResult,
} from './figma/normalize.js';
export {
  compareTokens,
  type FigmaComparison,
  type TokenMatch,
  type TokenMismatch,
} from './figma/compare.js';
export type {
  FigmaResolvedType,
  FigmaRgba,
  FigmaVariableAlias,
  FigmaVariableValue,
  FigmaVariable,
  FigmaVariableMode,
  FigmaVariableCollection,
  FigmaVariablesMeta,
  FigmaVariablesResponse,
  NormalizedFigmaToken,
} from './figma/types.js';
