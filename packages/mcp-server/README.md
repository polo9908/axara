# @axaraaudit/mcp-server

AxaraAudit **Model Context Protocol** server — JSON-RPC 2.0 over stdio, built on
the official `@modelcontextprotocol/sdk`. It lets an AI agent generate UI code
that is token-correct and RGAA-accessible *by construction*, audit a whole
project, and apply safe design-token fixes — through the exact same core
pipeline as the `axaraaudit` CLI, so scores and findings are identical across
surfaces.

## Register in an MCP client

One-liner for Claude Code:

```bash
claude mcp add axara -- npx -y @axaraaudit/mcp-server
```

Or in any MCP client config:

```json
{
  "mcpServers": {
    "axara": {
      "command": "npx",
      "args": ["-y", "@axaraaudit/mcp-server"],
      "env": { "A11YENGINE_TOKENS": "/abs/path/design-tokens.dtcg.json" }
    }
  }
}
```

The `A11YENGINE_TOKENS` variable is optional — without it the server discovers
`design-tokens.dtcg.json` (and friends) in the working directory, and
project-level tools fall back to the zero-config CSS custom-properties
extraction, exactly like the CLI.

## System prompt

The server ships an accessibility **system prompt** as MCP `instructions`
(surfaced to clients on `initialize`) and as a callable prompt
(`accessibility_engineer`). In short: never hard-code colors/spacing —
reference design tokens via `var(--token)` — always provide accessible names
and required ARIA, validate before delivering, and use the project tools to
audit and remediate an existing codebase.

## Tools

Every tool declares an `outputSchema` (results are returned as validated
`structuredContent`) and MCP behavior annotations: all tools are read-only and
idempotent **except** `fix_drift`, which writes files when — and only when —
`write: true` is passed.

### `get_design_system_rules` *(read-only)*
Reads the project's DTCG tokens and returns them with their ready-to-use
`var(--token)` reference, grouped by category.
Input: `{ tokensPath?: string }` (else `$A11YENGINE_TOKENS` or auto-discovery).

### `validate_component_code` *(read-only)*
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

### `audit_project` *(read-only)*
Runs the full AxaraAudit pipeline (token drift + RGAA) on a project directory
and returns the 0–100 conformity score, the CI-gate verdict, and the worst
findings first. The response is deliberately compact (`maxDriftIssues` /
`maxRgaaFindings`, default 30 each) to preserve the agent's context window —
the untruncated payload is available through the `axara://report/latest`
resource.
Input: `{ projectDir?, configPath?, tokensPath?, skipRgaa?, maxDriftIssues?, maxRgaaFindings? }`.

### `fix_drift` *(writes files when `write: true`)*
Applies the mechanical, position-verified design-drift fixes
(`#6366f1` → `var(--color-brand-primary)`). **Dry-run by default**: nothing
touches disk unless `write: true`. `includeNearMatches: true` also applies
close-but-not-exact values above `minConfidence` (default 0.7). RGAA issues are
never auto-fixed — they need a human (or generation-time) decision.
Input: `{ projectDir?, configPath?, tokensPath?, write?, includeNearMatches?, minConfidence? }`.

### `explain_rule` *(read-only)*
Returns an RGAA 4.1 criterion's metadata — theme, official wording, WCAG 2.1
references — and the axe-core rules mapped onto it. Pass a bare theme number
(`"11"`) to list every covered criterion of that theme.
Input: `{ criterion: string }`.

## Resources

| URI | Content |
|---|---|
| `axara://design-tokens` | The raw DTCG token document (source of truth). |
| `axara://config` | The resolved `.auditorrc.json` (defaults included). |
| `axara://report/latest` | Full payload of the session's last `audit_project` run. |

## Suggested agent workflow

1. `get_design_system_rules` → generate code referencing `var(--token)`.
2. `validate_component_code` on each produced component → fix → re-validate.
3. `audit_project` for a whole-codebase score; `explain_rule` to dig into any criterion.
4. `fix_drift` (dry-run) → show the preview → `fix_drift { write: true }`.

## Run from source

```bash
pnpm --filter @axaraaudit/mcp-server build
node packages/mcp-server/dist/index.js          # speaks JSON-RPC on stdio
node packages/mcp-server/scripts/stdio-smoke.mjs # end-to-end demo
```
