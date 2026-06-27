# @a11yengine/runtime

Headless **runtime** checks that static analysis can't do: real keyboard focus
behavior (focus traps) via Playwright, and a **Figma Variables** connector to
compare the design source of truth against the code's tokens.

## Focus-trap detection

```ts
import { auditFocusOrder } from '@a11yengine/runtime';

const report = await auditFocusOrder('<button>One</button><a href="#">Two</a>');
// { isTrap, trapKind: 'none'|'stuck'|'cycle', reachedExit, focusOrder, message }
```

The component is mounted in isolation between two sentinel buttons; `Tab` is
pressed up to `maxTabs` times while `document.activeElement` is snapshotted. The
pure {@link analyzeFocusOrder} then decides:

- **`cycle`** — focus loops back inside the component before escaping → trap.
- **`stuck`** — focus never moves → trap.
- reaching the trailing sentinel → focus escaped normally (no trap).
- otherwise `inconclusive` (raise `maxTabs`) — never a false positive.

Requires a browser: `pnpm exec playwright install chromium`. The detection logic
itself is pure and unit-tested without a browser.

## Figma Variables connector

```ts
import { FigmaClient, normalizeFigmaVariables, compareTokens } from '@a11yengine/runtime';
import { parseDtcgString } from '@a11yengine/core';

const figma = new FigmaClient({ token: process.env.FIGMA_TOKEN! });
const { meta } = await figma.getLocalVariables(fileKey); // GET /v1/files/:key/variables/local
const { tokens: figmaTokens } = normalizeFigmaVariables(meta);

const { tokens: codeTokens } = parseDtcgString(dtcgJson);
const diff = compareTokens(figmaTokens, codeTokens);
// { matches, mismatches, missingInCode, missingInFigma, summary: { inSync } }
```

- Resolves variable **aliases** (cycle-safe) and selects a collection **mode**.
- Converts COLOR → canonical hex and FLOAT → `<n>px`, reusing core's color/dimension
  utilities so Figma and code share one canonical form (e.g. `0.5rem` ≡ `8px`).
- The HTTP `fetch` is injectable, so normalization/compare are tested without network.

## Demo

```bash
pnpm --filter @a11yengine/runtime build
node packages/runtime/scripts/runtime-smoke.mjs
```
