/**
 * Zero-dependency file collection. `include` entries are files or directories
 * (walked recursively); `exclude` entries match any path segment. Extension
 * filtering happens last. Deterministic (sorted) so reports are diffable.
 */

import { readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Directories never worth scanning, whatever the config says. */
const ALWAYS_EXCLUDED = new Set(['node_modules', '.git']);

function isExcluded(relPath: string, exclude: readonly string[]): boolean {
  const segments = relPath.split(sep);
  return segments.some((segment) => ALWAYS_EXCLUDED.has(segment) || exclude.includes(segment));
}

export function collectFiles(
  rootDir: string,
  include: readonly string[],
  exclude: readonly string[],
  extensions: readonly string[],
): string[] {
  const found = new Set<string>();
  const extSet = new Set(extensions.map((ext) => ext.toLowerCase()));

  const visit = (absPath: string): void => {
    const rel = relative(rootDir, absPath);
    if (rel !== '' && isExcluded(rel, exclude)) return;

    let stats;
    try {
      stats = statSync(absPath);
    } catch {
      return; // broken symlink or permission issue: skip silently
    }

    if (stats.isDirectory()) {
      for (const entry of readdirSync(absPath)) visit(join(absPath, entry));
      return;
    }
    if (extSet.has(extname(absPath).toLowerCase())) found.add(absPath);
  };

  for (const entry of include) {
    visit(isAbsolute(entry) ? entry : resolve(rootDir, entry));
  }

  return [...found].sort();
}
