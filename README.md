<div align="center">

# AxaraAudit

**Accessibility (RGAA 4.1 / WCAG) and design-token consistency — for humans *and* AI agents.**

[![npm version](https://img.shields.io/npm/v/%40axaraaudit%2Fcli?label=%40axaraaudit%2Fcli&color=6366f1)](https://www.npmjs.com/package/@axaraaudit/cli)
[![npm version](https://img.shields.io/npm/v/%40axaraaudit%2Fmcp-server?label=%40axaraaudit%2Fmcp-server&color=6366f1)](https://www.npmjs.com/package/@axaraaudit/mcp-server)
[![license](https://img.shields.io/badge/license-MIT-6366f1)](#license)
[![node](https://img.shields.io/badge/node-%E2%89%A520-6366f1)](#requirements)

</div>

AxaraAudit scans your codebase and tells you three things:

| | |
|---|---|
| 🎨 | Hard-coded colors/spacing that should use your design tokens — `#6366f1` → `var(--color-brand-primary)` |
| ♿ | Accessibility violations against RGAA 4.1 / WCAG — missing `alt`, inputs without labels, keyboard traps… |
| 📊 | A single 0–100 compliance score you can use to gate your CI pipeline |

And — what sets it apart — it does the same thing **inside an AI agent's generation loop**, not just after the fact: a Claude Code plugin validates every file an agent writes in real time, and an MCP server exposes the same rules and audit engine as tools any agent can call.

> **Open-core model**: the local audit is 100% free and open source. Cloud features (dashboard, remote sync, history) are Pro.

---

## Contents

- [Try it in 10 seconds](#try-it-in-10-seconds-zero-config)
- [🤖 Built for AI agents](#-built-for-ai-agents) — Claude Code plugin, MCP server, `check` command
- [Feature tour](#feature-tour)
- [Installation](#installation)
- [Getting started with a config file](#getting-started-with-a-config-file)
- [CI/CD integration](#cicd-integration)
- [Configuration reference](#auditorrcjson-reference)
- [Token format](#token-format-design-tokensdtcgjson)
- [Monorepo packages](#monorepo-packages)
- [Development](#development)

---

## Try it in 10 seconds (zero config)

In any web project — **no config file needed**:

```bash
npx @axaraaudit/cli audit
```

AxaraAudit automatically detects your design system from existing CSS custom
properties (`:root { --color-primary: ... }`) and audits the whole project:
token drift + RGAA accessibility, with a score out of 100.

```
✓ Zero-config: 45 tokens extracted from 1 CSS file.

  AXARA AUDIT — my-project
  18 file(s) analyzed
  ...
  SCORE  96/100
```

> A `design-tokens.dtcg.json` file (or `.auditorrc.json`) remains the recommended
> source of truth once you want to fine-tune things — it takes priority if present.

Like it? `npm i -g axaraaudit` gives you the `axa` shortcut and an interactive
command palette — see [Installation](#installation).

---

## 🤖 Built for AI agents

Today's products need to work for the humans **and** the agents writing code for them.
AxaraAudit ships three layers so an agent generates UI that is accessible and
token-correct **by construction**, not fixed up after review — and every layer runs
the exact same audit engine, so the score never disagrees with itself.

### 1. Claude Code plugin — validation in real time

```
/plugin marketplace add polo9908/axara
/plugin install axara-audit@axara
```

A `PostToolUse` hook fires after every `Edit`/`Write` on a UI file. If the agent
just wrote a hard-coded color or an image with no `alt`, it gets told immediately
— and fixes its own code before you ever open the diff:

```
Claude writes Header.tsx:
  <img src="hero.png" />
  color: #6366f1;

              ↓ hook runs `axaraaudit check` automatically

AxaraAudit : 2 problème(s) d'accessibilité/design system dans Header.tsx :
- RGAA 1.1 (critical) : Chaque image porteuse d'information a-t-elle
  une alternative textuelle ? — élément : <img src="hero.png">
- L12 color: #6366f1 → remplace par var(--color-brand-primary)
Corrige ce fichier immédiatement…

              ↓ Claude corrects it on its own, no human involved
```

The plugin also bundles the MCP server below and a design-system skill.
[Plugin docs →](claude-plugin/README.md)

### 2. MCP server — tools for any agent

```bash
claude mcp add axara -- npx -y @axaraaudit/mcp-server
```

Five tools an agent can call directly from its context, each with a declared
output schema and read-only/destructive annotations:

| Tool | What it does |
|---|---|
| `get_design_system_rules` | Returns your DTCG tokens as ready-to-use `var(--token)` references |
| `validate_component_code` | Audits a React/Vue/HTML snippet for RGAA + drift before it's shipped |
| `audit_project` | Full-project score + worst violations first (same engine as the CLI) |
| `fix_drift` | Applies safe token fixes — **dry-run by default**, `write: true` to persist |
| `explain_rule` | Explains any RGAA criterion (wording, WCAG refs, mapped axe-core rules) |

Plus resources: `axara://design-tokens`, `axara://config`, `axara://report/latest`.
[MCP server docs →](packages/mcp-server/README.md)

### 3. `axaraaudit check` — the automation primitive

```bash
npx axaraaudit check src/Header.tsx --format json
```

```json
{
  "conformant": false,
  "summary": { "filesChecked": 1, "driftIssues": 1, "rgaaFailed": 1, "rgaaToReview": 0 },
  "files": [{
    "file": "src/Header.tsx",
    "rgaa": [{ "criterion": "1.1", "impact": "critical", "status": "failed" }],
    "drift": [{ "line": 12, "property": "color", "value": "#6366f1", "replacement": "var(--color-brand-primary)" }]
  }]
}
```

Exit `0` = conformant, exit `1` = violations found. Validates specific files
without walking the whole project — built for hooks (the plugin above uses it),
`pre-commit`, `lint-staged`, or any custom agent loop. Works even with no design
system at all (falls back to RGAA-only).

> **Why this matters:** CLI, MCP server and Claude Code plugin all call the same
> `@axaraaudit/core` pipeline. A CI gate and a coding agent never disagree about
> whether a component is conformant.

---

## Feature tour

### 1. Catch design tokens drifting out of sync

Your team defined design tokens (`--color-brand-primary: #6366f1`), but someone
hard-coded the hex value directly in a component instead of using the variable.
Now if the brand color changes, that one component silently stays wrong.

```bash
npx axaraaudit audit
```

```
components/Header.tsx
  L12  background-color  #6366f1 → var(--color-brand-primary)  [auto-fix]
  L12  padding           16px → var(--space-4)                  [auto-fix]
```

### 2. Catch accessibility violations (RGAA / WCAG)

```
RGAA 4.1
  ✖ 1.1  Image without a text alternative   (critical)
  ✖ 11.1 Input without an associated label  (serious)
```

Concretely:
- `<img src="hero.png" />` with no `alt` → a blind user's screen reader has nothing to announce.
- `<input type="email" />` with no `<label>` → a keyboard/screen-reader user doesn't know what the field is for.

### 3. Get a single compliance score (0–100)

```
SCORE  76/100
```

Use it to gate your CI: if the score drops below your threshold, the pipeline fails.

```bash
npx axaraaudit audit --ci --fail-under 90
# score < 90 → exit code 1, the merge is blocked
```

### 4. Auto-fix the drift — three levels of confidence

```bash
# Preview only, changes nothing
npx axaraaudit fix

# Apply the fixes to your files
npx axaraaudit fix --write
```

**Before:**
```css
background-color: #6366f1;
padding: 16px 32px;
```

**After:**
```css
background-color: var(--color-brand-primary);
padding: var(--space-4) var(--space-8);
```

| Level | Fixes | Guarantee |
|---|---|---|
| `fix` | Values that exactly match a token | 100% safe, checked value-by-value |
| `fix --all` | + values *close* to a token | Adjustable confidence threshold (`--min-confidence`) |
| `fix --ai` | + RGAA issues (alt, labels, headings…) + values with no matching token | AI-generated proposals from Claude, before/after diff |

> ⚠️ RGAA violations (missing `alt`, missing `label`…) are **never** auto-fixed by the
> mechanical modes — they require a human design decision (unless you opt into `--ai`).

### 5. Let Claude write the actual accessibility fixes (`fix --ai`, opt-in)

```bash
npx axaraaudit fix --ai --write
```

**Before:**
```html
<img src="hero.png" />
<input type="email" />
```

**After (proposed by Claude):**
```html
<img src="hero.png" alt="Illustration of a rocket launching" />
<input type="email" aria-labelledby="email-label" />
<label id="email-label">Your email address</label>
```

Nothing is sent to the API unless you pass `--ai`. Set up once:

```bash
npx axaraaudit login --anthropic-key sk-ant-...
# or set ANTHROPIC_API_KEY as an env var (ideal for CI)
```

```bash
npx axaraaudit fix --ai                            # preview: before/after diff per file
npx axaraaudit fix --ai --write                    # apply the proposed fixes
npx axaraaudit fix --ai --model claude-sonnet-5    # cheaper model
```

Every run prints the number of API tokens consumed. Default model: `claude-opus-4-8`.

### 6. Hear your site the way a screen-reader user does

```bash
npx axaraaudit voice src/Header.tsx
```

```
components/Header.tsx
  🔊 region: navigation — Main navigation
  🔊 link: Home
  🔊 link
     ⚠ RGAA 6.1 — link with no accessible name — the user only hears "link"
  🔊 image
     ⚠ RGAA 1.1 — image without a text alternative

5 degraded announcement(s) out of 14 — invisible to the eye, glaring to the ear.
```

No config, no browser required.

### 7. Track your score across commits

```bash
npx axaraaudit history --limit 20
```

```
2026-06-12  a1b2c3d  62   feat: landing page
2026-06-19  e4f5a6b  71   fix: tokenize buttons
2026-07-03  c7d8e9f  96   chore: axaraaudit fix --all

SCORE  62 ▁▃▅▆▇█ 96   (+34 🎉)
```

Replays the audit against past commits without checking anything out.

### 8. Find out who introduced the drift

```bash
npx axaraaudit blame
```

```
🥇 Bob Dupont — 7 drift(s)
   ≈ src/app.css:L13  padding: 80px (e534a7e, 2026-06-12)
```

No hard feelings — `axaraaudit fix --all --write` wipes the slate clean.

### 9. Get your results roasted (with a fix plan)

```bash
npx axaraaudit roast
```

Claude comments on your audit results with sharp-but-friendly humor, then gives
you a 3-step "redemption plan." Great for sharing with the team without sounding
preachy (requires an Anthropic key, same as `fix --ai`).

### 10. Validate specific files, fast (`check`)

```bash
npx axaraaudit check src/Header.tsx src/app.css
```

```
  CHECK — 2 fichier(s)

  src/Header.tsx
    ✖ RGAA 1.1 — Chaque image porteuse d'information a-t-elle une alternative textuelle ? (critical)
  src/app.css
    ≈ L1  background-color: #6366f1 → var(--color-brand-primary)

  ✖ 1 violation(s) RGAA, 1 drift(s)
```

The building block behind the Claude Code plugin's hook — see
[Built for AI agents](#-built-for-ai-agents) above.

---

## Installation

**Recommended — global install** (like `claude`, `eslint -g`…): install once, then the
command is available everywhere, no `npx` prefix:

```bash
npm install -g axaraaudit

axaraaudit audit     # full command
axa audit            # short alias — same CLI
axa                  # no argument → interactive palette (see below)
```

**Zero-install trial** — run it once in any project without installing anything:

```bash
npx axaraaudit audit
```

**Project-local install** — pin the version in the repo, ideal for CI and teams:

```bash
npm install -D @axaraaudit/cli     # or: pnpm add -D @axaraaudit/cli
npx axaraaudit audit               # resolves to the local version
```

> The examples below use `npx axaraaudit ...` so they work in all three setups —
> with the global install you can always shorten them to `axa ...`.

### Interactive palette — no flags to memorize

Type `axa` (or `axaraaudit`) with no argument in a terminal and you get a
Claude-Code-style command palette: type to filter (a leading `/` is tolerated),
arrows to navigate, Tab to complete, Enter to run — and after the command
finishes you're back in the palette, like a session. Esc quits.

On a project that already has an `.auditorrc.json`, the palette opens with
`audit` pre-selected — pressing Enter immediately runs the audit.

```
  axaraaudit — tapez pour filtrer · ↑↓ naviguer · Tab compléter · Entrée exécuter · Échap quitter
  ❯ /au▌
   ▸ audit     Analyse le projet : score /100, dérive tokens + RGAA
     ...
```

### Shell completions (Tab)

Generated from the same command catalog as the help — subcommands and their flags:

```bash
eval "$(axaraaudit completion bash)"    # ~/.bashrc
eval "$(axaraaudit completion zsh)"     # ~/.zshrc (after compinit)
axaraaudit completion pwsh | Out-String | Invoke-Expression   # PowerShell $PROFILE
```

### Language — English / French

Every CLI message exists in both languages. The language is picked from your
system locale automatically; override it per run or globally:

```bash
axa audit --lang en        # per run
AXARA_LANG=fr axa audit    # env var (put it in your shell profile to persist)
```

### Update notifications

When a newer version is on npm, the CLI prints a one-line notice (at most once
a day, never in CI, never when output is piped). The registry check runs in a
detached background process — it never slows a command down. Opt out with
`AXARA_NO_UPDATE_CHECK=1`.

---

## Getting started with a config file

### 1. Initialize

```bash
npx axaraaudit init
```

Creates `.auditorrc.json` at your project root:

```json
{
  "project": "my-app",
  "tokens": "./design-tokens.dtcg.json",
  "include": ["src", "components", "styles"],
  "exclude": ["node_modules", "dist", ".next"],
  "extensions": [".css", ".scss", ".tsx", ".jsx", ".html"],
  "rgaa": {
    "enabled": true,
    "priority": ["1.1", "3.2", "11.1"]
  },
  "ci": {
    "failUnder": 80
  }
}
```

### 2. Run the audit

```bash
npx axaraaudit audit

# JSON output instead of the terminal report
npx axaraaudit audit --format json
npx axaraaudit audit --out report.json

# Design drift only, skip RGAA
npx axaraaudit audit --skip-rgaa

# CI mode: exit code 1 if the score is below threshold
npx axaraaudit audit --ci --fail-under 90

# Use a different config or tokens file
npx axaraaudit audit --config ./config/audit.json
npx axaraaudit audit --tokens ./tokens/brand.dtcg.json
```

### 3. Fix what can be fixed

```bash
npx axaraaudit fix               # preview
npx axaraaudit fix --write       # apply
npx axaraaudit fix --all --write # include near-matches (confidence ≥ 0.7)
npx axaraaudit fix --ai --write  # + AI fixes for RGAA and unmatched values
```

### 4. Validate specific files (fast path)

```bash
npx axaraaudit check src/Header.tsx --format json   # exit 0 conformant, 1 otherwise
```

### 5. Pro authentication (optional)

```bash
npx axaraaudit login --token <your-token>
npx axaraaudit whoami
npx axaraaudit logout
```

In CI, prefer the environment variable (never written to disk):

```bash
AUDITOR_TOKEN=<your-token> npx axaraaudit audit --ci --upload
```

---

## CI/CD integration

```yaml
name: Accessibility & design system audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: npx axaraaudit audit --ci --out audit-report.json
        env:
          AUDITOR_TOKEN: ${{ secrets.AUDITOR_TOKEN }}   # optional (Pro)
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: audit-report
          path: audit-report.json
```

**Exit codes** (`audit`, `check`):

| Code | Meaning |
|---|---|
| `0` | Passed (score/gate OK, or `check` found no violation) |
| `1` | CI gate failed (score below threshold, blocking criterion, or `check` found a violation) |
| `2` | Configuration error |

---

## `.auditorrc.json` reference

```jsonc
{
  // Project name (shown in the report)
  "project": "my-app",

  // Tokens file in DTCG format (source of truth for design)
  "tokens": "./design-tokens.dtcg.json",

  // Folders/files to analyze
  "include": ["src", "components", "styles"],
  "exclude": ["node_modules", "dist", "build", ".next"],
  "extensions": [".css", ".scss", ".tsx", ".jsx", ".html"],

  // rem → px base for normalizing spacing
  "remBasePx": 16,

  "rgaa": {
    "enabled": true,
    // "component" ignores page-level rules (h1, landmarks) for isolated components
    // "page" for auditing a full HTML page
    "scope": "component",
    // RGAA criteria that block CI regardless of impact level
    "priority": ["1.1", "3.2", "11.1"]
  },

  "ci": {
    // Minimum 0–100 score required to pass the gate
    "failUnder": 80,
    // Block on any critical or serious violation
    "blockOnCritical": true
  },

  // Pro features
  "pro": {
    "apiUrl": "https://api.axara.dev",
    "upload": false,       // send every report to the dashboard
    "remoteConfig": false  // fetch rules/tokens from the API
  }
}
```

---

## Token format (`design-tokens.dtcg.json`)

Standard [DTCG](https://design-tokens.github.io/community-group/format/) format:

```json
{
  "color": {
    "$type": "color",
    "brand": {
      "primary": { "$value": "#6366f1" },
      "secondary": { "$value": "#8b5cf6" }
    },
    "neutral": {
      "900": { "$value": "#111827" },
      "white": { "$value": "#ffffff" }
    }
  },
  "space": {
    "$type": "dimension",
    "4": { "$value": "16px" },
    "8": { "$value": "32px" }
  }
}
```

Tokens automatically generate kebab-case CSS variables:
- `color.brand.primary` → `var(--color-brand-primary)`
- `space.8` → `var(--space-8)`

---

## Monorepo packages

| Package | Role |
|---|---|
| [`@axaraaudit/core`](packages/core/README.md) | Engine: DTCG parsing, AST analysis, RGAA/axe-core, auto-fix, project orchestration (audit/fix/check/score) |
| [`@axaraaudit/cli`](packages/cli/README.md) | The `axaraaudit` CLI (what you use day to day) |
| [`@axaraaudit/runtime`](packages/runtime/README.md) | Playwright: keyboard trap detection + Figma Variables sync |
| [`@axaraaudit/mcp-server`](packages/mcp-server/README.md) | MCP server for AI agents: project audit, component validation, safe auto-fix |
| [`claude-plugin/`](claude-plugin/README.md) | Claude Code plugin: real-time validation hook + bundled MCP server + skill |

---

## Development

```bash
# Clone and install
git clone https://github.com/polo9908/axara.git
cd axara
pnpm install

# Build all packages
pnpm -r build

# Run tests (168 tests)
pnpm -r test

# Strict typecheck
pnpm -r typecheck

# Run the CLI directly from source
node packages/cli/dist/index.js audit
```

---

## Requirements

- Node.js ≥ 20
- pnpm 10

## License

MIT
