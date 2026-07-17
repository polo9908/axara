/**
 * Moved to @axaraaudit/core (`core/src/figma/types.ts`) so the CLI can import
 * the Figma connector without pulling Playwright. Thin re-exports keep the
 * runtime public API stable.
 */

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
} from '@axaraaudit/core';
