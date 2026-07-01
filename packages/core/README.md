# @axaraaudit/core

Core logic for A11yEngine: DTCG token parsing and **static Design-Drift detection**
for `.css` / `.tsx` source. Zero runtime config â€” point it at a DTCG token file
and your source files.

## What it does

1. **Parses DTCG tokens** (`parseDtcg` / `parseDtcgString`)
   - Flattens the group/token tree to dot-paths + CSS variable names.
   - Inherits `$type` from ancestor groups.
   - Resolves `{group.token}` aliases, with cycle & unknown-target detection.
   - Builds valueâ†’token indexes for colors (canonical sRGB) and dimensions
     (normalized to px).

2. **Analyzes source statically**
   - **CSS** via PostCSS (`analyzeCss`): colors on every declaration, spacing on
     spacing-related properties only.
   - **TSX/JSX** via the TypeScript Compiler API (`analyzeTsx`): inline
     `style={{â€¦}}` objects (colors + spacing, React-numeric â†’ px) and color
     literals in any string/template (styled-components, theme constants).

3. **Emits a structured drift report** â€” for each hard-coded value:
   `exact-token` (safe auto-fix â†’ `var(--token)`), `nearest-token` (suggested),
   or `no-token`, with confidence, location, and a ready-to-apply replacement.

## Usage

```ts
import { auditPaths, auditSources } from '@axaraaudit/core';

// From disk:
const report = auditPaths('design-tokens.dtcg.json', ['src/Button.tsx', 'src/app.css']);

// Or in-memory:
const report2 = auditSources(tokensJson, [{ path: 'Button.tsx', content }]);

console.log(report.summary); // { filesScanned, totalIssues, errors, warnings, autoFixable }
```

## Scripts

```bash
pnpm --filter @axaraaudit/core test       # vitest
pnpm --filter @axaraaudit/core typecheck  # tsc --noEmit (strict)
pnpm --filter @axaraaudit/core build      # emit dist/
```

## RGAA wrapper (axe-core)

Runs axe-core headlessly and re-keys its findings onto **RGAA 4.1** criteria,
then exports a **DINUM/Ara-compatible** declaration.

```ts
import { auditHtmlRgaa, toAraDeclaration } from '@axaraaudit/core';

const report = await auditHtmlRgaa('<img src="logo.png">');
// report.findings â†’ [{ criterion: '1.1', themeLabel: 'Images', axeRuleId: 'image-alt', ... }]

const declaration = toAraDeclaration(report); // { referential: 'RGAA', criteria: [{ status: 'NC', ... }] }
```

- `mapAxeResults(axeResults)` â€” pure mapper from raw `AxeResults` (e.g. produced
  by the Playwright runtime at step 4) to a `RgaaReport`. The axeâ†’RGAA table
  lives in `src/rgaa/mapping.ts`; unmapped rules are surfaced, never dropped.
- `runAxeOnHtml` / `auditHtmlRgaa` â€” execute axe-core inside JSDOM by injecting
  `axe.source`. **Contrast** (`color-contrast`) needs real rendering and is
  therefore disabled under JSDOM (accurate pass = Playwright, step 4); it is
  surfaced as *cantTell* otherwise.
- `toAraDeclaration` â€” only emits the criteria detected as **non-conforme (NC)**;
  the global conformance rate and `C`/`NA` criteria require a manual RGAA grid
  (stated in the declaration `note`).

See `../../examples/` for runnable demos:
`node examples/smoke.mjs` (design drift) and `node examples/rgaa-smoke.mjs` (RGAA â†’ Ara).
