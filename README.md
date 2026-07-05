# AxaraAudit

**Automatic accessibility and design-system consistency checker.**

AxaraAudit scans your codebase and tells you three things:

1. 🎨 Hard-coded colors/spacing that should use your design tokens (`#6366f1` → `var(--color-brand-primary)`)
2. ♿ Accessibility violations against RGAA 4.1 / WCAG (missing `alt`, inputs without labels, keyboard traps…)
3. 📊 A 0–100 compliance score you can use to block your CI pipeline when quality drops

> **Open-core model**: the local audit is 100% free and open source. Cloud features (dashboard, remote sync, history) are Pro.

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

---

## What can you actually do with it? A quick tour

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

---

## Installation (once you're past the `npx` trial)

```bash
npm install -D @axaraaudit/cli
```

> 💡 **npm vs npx vs pnpm — what's the difference?**
> - `npm install` **installs** the package in your project (once)
> - `npx axaraaudit ...` **runs** the installed command (every time you use it)
> - Using **pnpm**? Same idea: `pnpm add -D @axaraaudit/cli` then `pnpm exec axaraaudit ...`
>
> All commands below use `npx`, which works either way.

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

### 4. Pro authentication (optional)

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

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Audit passed (or non-CI mode) |
| `1` | CI gate failed (score below threshold or blocking criterion) |
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
| [`@axaraaudit/core`](packages/core/README.md) | Engine: DTCG parsing, AST analysis, RGAA/axe-core, auto-fix |
| [`@axaraaudit/cli`](packages/cli/README.md) | The `axaraaudit` CLI (what you use day to day) |
| [`@axaraaudit/runtime`](packages/runtime/README.md) | Playwright: keyboard trap detection + Figma Variables sync |
| [`@axaraaudit/mcp-server`](packages/mcp-server/README.md) | MCP server for Claude/LLM integration |

---

## Development

```bash
# Clone and install
git clone https://github.com/polo9908/axara.git
cd axara
pnpm install

# Build all packages
pnpm -r build

# Run tests (118 tests)
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
