# A11yEngine

Hybrid **static + runtime** audit engine for design systems — strict **RGAA 4.1.2 / 5.0**
conformance and design/code integrity, with SaaS-grade developer experience.

A11yEngine combines a static AST analyzer (catch design drift and structural a11y
issues before the browser) with a headless runtime (real focus order, contrast and
DOM behavior) and an MCP server so AI agents generate token-correct, accessible code
by construction.

## Monorepo layout

| Package | Role | Status |
|---|---|---|
| `packages/core` | Shared logic: DTCG token parsing, static drift analysis, RGAA/axe wrapper, Ara export | ✅ Step 1 & 2 |
| `packages/cli` | Command-line executable | ⏳ planned |
| `packages/mcp-server` | Model Context Protocol server (JSON-RPC 2.0 / stdio) | ⏳ planned |
| `packages/runtime` | Headless Playwright engine (focus traps, live contrast, Figma sync) | ⏳ planned |

## What works today (`@a11yengine/core`)

1. **Design-drift detection** — parses DTCG tokens (alias resolution, `$type`
   inheritance), then statically scans `.css` (PostCSS) and `.tsx`/`.jsx`
   (TypeScript Compiler API) for hard-coded colors/spacing, emitting
   auto-fixable `var(--token)` suggestions with confidence scores.
2. **RGAA wrapper** — runs axe-core headlessly, maps ~80 axe rules onto RGAA 4.1
   criteria, and exports a DINUM/**Ara**-compatible accessibility declaration.

```bash
pnpm install
pnpm -r build
pnpm -r test                      # 57 tests
node examples/smoke.mjs           # design-drift demo
node examples/rgaa-smoke.mjs      # RGAA → Ara demo
```

See [`packages/core/README.md`](packages/core/README.md) for the full API.

## Requirements

- Node.js ≥ 20
- pnpm 10

## Roadmap

- [x] **Step 1** — Monorepo, ultra-strict TypeScript, DTCG parser & drift analyzer
- [x] **Step 2** — axe-core wrapper, RGAA mapping, Ara export
- [ ] **Step 3** — Active MCP server (`get_design_system_rules`, `validate_component_code`)
- [ ] **Step 4** — Playwright runtime (focus-trap detection) & Figma Variables sync

## License

MIT (to be confirmed).
