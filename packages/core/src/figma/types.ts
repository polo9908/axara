/**
 * Subset of the Figma REST "local variables" response we consume.
 * See: GET https://api.figma.com/v1/files/:file_key/variables/local
 */

export type FigmaResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export interface FigmaRgba {
  readonly r: number; // 0–1
  readonly g: number; // 0–1
  readonly b: number; // 0–1
  readonly a: number; // 0–1
}

export interface FigmaVariableAlias {
  readonly type: 'VARIABLE_ALIAS';
  readonly id: string;
}

export type FigmaVariableValue = FigmaRgba | FigmaVariableAlias | number | string | boolean;

export interface FigmaVariable {
  readonly id: string;
  readonly name: string;
  readonly variableCollectionId: string;
  readonly resolvedType: FigmaResolvedType;
  readonly valuesByMode: Readonly<Record<string, FigmaVariableValue>>;
}

export interface FigmaVariableMode {
  readonly modeId: string;
  readonly name: string;
}

export interface FigmaVariableCollection {
  readonly id: string;
  readonly name: string;
  readonly defaultModeId: string;
  readonly modes: readonly FigmaVariableMode[];
}

export interface FigmaVariablesMeta {
  readonly variables: Readonly<Record<string, FigmaVariable>>;
  readonly variableCollections: Readonly<Record<string, FigmaVariableCollection>>;
}

export interface FigmaVariablesResponse {
  readonly status?: number;
  readonly error?: boolean;
  readonly meta: FigmaVariablesMeta;
}

/** A Figma variable normalized into the same shape we compare code tokens against. */
export interface NormalizedFigmaToken {
  /** Dot path, e.g. `color.brand.primary` (Figma `name` with `/`→`.`). */
  readonly path: string;
  readonly type: 'color' | 'dimension';
  /** Canonical value: hex for colors, `<n>px` for dimensions. */
  readonly value: string;
  readonly figmaId: string;
  readonly figmaName: string;
  /** Collection mode the value was resolved in. */
  readonly mode: string;
}
