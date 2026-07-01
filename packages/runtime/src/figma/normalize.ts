/**
 * Normalize Figma variables into comparable tokens.
 *
 * Resolves variable aliases (with cycle detection) and selects a collection mode
 * (the collection's default mode unless a mode name is given), then converts
 * COLOR variables to canonical hex and FLOAT variables to `<n>px`, reusing the
 * core color utilities so Figma and code values share one canonical form.
 */

import { toHex, type Rgb } from '@axaraaudit/core';
import type {
  FigmaRgba,
  FigmaVariable,
  FigmaVariableAlias,
  FigmaVariablesMeta,
  FigmaVariableValue,
  NormalizedFigmaToken,
} from './types.js';

export interface NormalizeOptions {
  /** Mode *name* to resolve values in (defaults to each collection's default). */
  readonly mode?: string;
}

export interface NormalizeResult {
  readonly tokens: readonly NormalizedFigmaToken[];
  readonly errors: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAlias(value: FigmaVariableValue): value is FigmaVariableAlias {
  return isRecord(value) && value['type'] === 'VARIABLE_ALIAS' && typeof value['id'] === 'string';
}

function isRgba(value: FigmaVariableValue): value is FigmaRgba {
  return (
    isRecord(value) &&
    typeof value['r'] === 'number' &&
    typeof value['g'] === 'number' &&
    typeof value['b'] === 'number' &&
    typeof value['a'] === 'number'
  );
}

function pathFromName(name: string): string {
  return name
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('.');
}

function modeIdFor(
  meta: FigmaVariablesMeta,
  variable: FigmaVariable,
  requestedMode: string | undefined,
): string | null {
  const collection = meta.variableCollections[variable.variableCollectionId];
  if (!collection) return null;
  if (requestedMode) {
    const match = collection.modes.find((m) => m.name === requestedMode);
    if (match && variable.valuesByMode[match.modeId] !== undefined) return match.modeId;
  }
  if (variable.valuesByMode[collection.defaultModeId] !== undefined) return collection.defaultModeId;
  // Fall back to the first mode that actually carries a value.
  const firstKey = Object.keys(variable.valuesByMode)[0];
  return firstKey ?? null;
}

function rgbaToHex(value: FigmaRgba): string {
  const rgb: Rgb = {
    r: Math.round(value.r * 255),
    g: Math.round(value.g * 255),
    b: Math.round(value.b * 255),
    a: value.a,
  };
  return toHex(rgb);
}

/** Resolve a variable's primitive value in a mode, following aliases. */
function resolveValue(
  meta: FigmaVariablesMeta,
  variable: FigmaVariable,
  requestedMode: string | undefined,
  seen: Set<string>,
  errors: string[],
): Exclude<FigmaVariableValue, FigmaVariableAlias> | null {
  if (seen.has(variable.id)) {
    errors.push(`Alias cycle detected at Figma variable "${variable.name}".`);
    return null;
  }
  seen.add(variable.id);

  const modeId = modeIdFor(meta, variable, requestedMode);
  if (!modeId) {
    errors.push(`No resolvable mode for Figma variable "${variable.name}".`);
    return null;
  }
  const raw = variable.valuesByMode[modeId];
  if (raw === undefined) return null;

  if (isAlias(raw)) {
    const target = meta.variables[raw.id];
    if (!target) {
      errors.push(`Figma variable "${variable.name}" aliases unknown variable "${raw.id}".`);
      return null;
    }
    return resolveValue(meta, target, requestedMode, seen, errors);
  }
  return raw;
}

export function normalizeFigmaVariables(
  meta: FigmaVariablesMeta,
  options: NormalizeOptions = {},
): NormalizeResult {
  const tokens: NormalizedFigmaToken[] = [];
  const errors: string[] = [];

  for (const variable of Object.values(meta.variables)) {
    if (variable.resolvedType !== 'COLOR' && variable.resolvedType !== 'FLOAT') continue;

    const resolved = resolveValue(meta, variable, options.mode, new Set(), errors);
    if (resolved === null) continue;

    const collection = meta.variableCollections[variable.variableCollectionId];
    const mode = modeIdFor(meta, variable, options.mode) ?? collection?.defaultModeId ?? '';

    if (variable.resolvedType === 'COLOR') {
      if (!isRgba(resolved)) {
        errors.push(`Figma COLOR variable "${variable.name}" has a non-color value.`);
        continue;
      }
      tokens.push({
        path: pathFromName(variable.name),
        type: 'color',
        value: rgbaToHex(resolved),
        figmaId: variable.id,
        figmaName: variable.name,
        mode,
      });
    } else {
      if (typeof resolved !== 'number') {
        errors.push(`Figma FLOAT variable "${variable.name}" has a non-numeric value.`);
        continue;
      }
      tokens.push({
        path: pathFromName(variable.name),
        type: 'dimension',
        value: `${resolved}px`,
        figmaId: variable.id,
        figmaName: variable.name,
        mode,
      });
    }
  }

  return { tokens, errors };
}
