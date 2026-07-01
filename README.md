# A11yEngine

Hybrid **static + runtime** audit engine for design systems â€” strict **RGAA 4.1.2 / 5.0**
conformance and design/code integrity, with SaaS-grade developer experience.

A11yEngine combines a static AST analyzer (catch design drift and structural a11y
issues before the browser) with a headless runtime (real focus order, contrast and
DOM behavior) and an MCP server so AI agents generate token-correct, accessible code
by construction.

## Monorepo layout

| Package | Role | Status |
|---|---|---|
| `packages/core` | Shared logic: DTCG token parsing, static drift analysis, RGAA/axe wrapper, Ara export | âœ… Step 1 & 2 |
| `packages/mcp-server` | Model Context Protocol server (JSON-RPC 2.0 / stdio) | âœ… Step 3 |
| `packages/runtime` | Headless Playwright engine (focus traps) + Figma Variables connector | âœ… Step 4 |
| `packages/cli` | Command-line executable | â³ planned |

## What works today (`@axaraaudit/core`)

1. **Design-drift detection** â€” parses DTCG tokens (alias resolution, `$type`
   inheritance), then statically scans `.css` (PostCSS) and `.tsx`/`.jsx`
   (TypeScript Compiler API) for hard-coded colors/spacing, emitting
   auto-fixable `var(--token)` suggestions with confidence scores.
2. **RGAA wrapper** â€” runs axe-core headlessly, maps ~80 axe rules onto RGAA 4.1
   criteria, and exports a DINUM/**Ara**-compatible accessibility declaration.
3. **MCP server** â€” exposes `get_design_system_rules` and `validate_component_code`
   to AI agents over JSON-RPC 2.0 / stdio, with an accessibility system prompt.
4. **Runtime** â€” Playwright headless focus-trap detection and a Figma Variables
   connector that compares the design source of truth against code tokens.

```bash
pnpm install
pnpm -r build
pnpm -r test                                     # 91 tests
node examples/smoke.mjs                           # design-drift demo
node examples/rgaa-smoke.mjs                      # RGAA â†’ Ara demo
node packages/mcp-server/scripts/stdio-smoke.mjs  # MCP server over stdio
pnpm --filter @axaraaudit/runtime exec playwright install chromium
node packages/runtime/scripts/runtime-smoke.mjs   # focus trap + Figma compare
```

See the per-package READMEs for full APIs:
[`core`](packages/core/README.md) Â·
[`mcp-server`](packages/mcp-server/README.md) Â·
[`runtime`](packages/runtime/README.md).

## Requirements

- Node.js â‰¥ 20
- pnpm 10

## Roadmap

- [x] **Step 1** â€” Monorepo, ultra-strict TypeScript, DTCG parser & drift analyzer
- [x] **Step 2** â€” axe-core wrapper, RGAA mapping, Ara export
- [x] **Step 3** â€” Active MCP server (`get_design_system_rules`, `validate_component_code`)
- [x] **Step 4** â€” Playwright runtime (focus-trap detection) & Figma Variables sync

## License

MIT (to be confirmed).
