# @axaraaudit/mcp-server

A11yEngine **Model Context Protocol** server â€” JSON-RPC 2.0 over stdio, built on
the official `@modelcontextprotocol/sdk`. It lets an AI agent generate UI code
that is token-correct and RGAA-accessible *by construction*.

## System prompt

The server ships an accessibility **system prompt** as MCP `instructions`
(surfaced to clients on `initialize`) and as a callable prompt
(`accessibility_engineer`). In short: never hard-code colors/spacing â€” reference
design tokens via `var(--token)` â€” always provide accessible names and required
ARIA, and validate before delivering.

## Tools

### `get_design_system_rules`
Reads the project's DTCG tokens and returns them with their ready-to-use
`var(--token)` reference, grouped by category.
Input: `{ tokensPath?: string }` (else `$A11YENGINE_TOKENS` or auto-discovery).

### `validate_component_code`
Normalizes a React/Vue/HTML snippet to HTML, runs the RGAA (axe-core) audit on
its structure, checks design-token drift (React), and returns a conformance
verdict plus an Ara declaration.
Input:
```ts
{
  code: string;
  framework?: 'react' | 'vue' | 'html' | 'auto'; // default: auto-detect
  tokensPath?: string;
  checkDrift?: boolean;                            // default: true
  scope?: 'component' | 'page';                    // default: component
}
```
`scope: 'component'` disables page-level rules (h1, landmarks, skip-link) that
don't apply to an isolated fragment.

## Run

```bash
pnpm --filter @axaraaudit/mcp-server build
node packages/mcp-server/dist/index.js          # speaks JSON-RPC on stdio
node packages/mcp-server/scripts/stdio-smoke.mjs # end-to-end demo
```

Register in an MCP client:
```json
{
  "mcpServers": {
    "a11yengine": {
      "command": "node",
      "args": ["/abs/path/packages/mcp-server/dist/index.js"],
      "env": { "A11YENGINE_TOKENS": "/abs/path/design-tokens.dtcg.json" }
    }
  }
}
```
