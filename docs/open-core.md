# Open-core model

AxaraAudit is open core. The boundary fits in one sentence:

> **Everything that audits is free and open source. Everything that organizes
> several projects and people over time is Pro.**

This document explains what that means in practice — for contributors, for
users deciding what they pay for, and for anyone integrating against the Pro
API.

## What is free (this repository, MIT)

The entire audit engine lives here and stays here:

- `@axaraaudit/core` — DTCG token parsing, AST analysis, RGAA 4.1 / WCAG
  rules, auto-fix, scoring, `.auditorrc.json`.
- `@axaraaudit/cli` / `axaraaudit` — the full CLI: `audit`, `check`, `fix`
  (including `--ai` with your own Anthropic key), `voice`, `history`, `blame`,
  HTML/JSON reports, CI gate (`--ci --fail-under`).
- `@axaraaudit/mcp-server` — the MCP tools and resources, same engine.
- `claude-plugin/` — the Claude Code plugin (real-time hook, bundled MCP,
  skill).

Nothing in the free path phones home. No feature in this repository is
degraded, time-limited, or unlockable by a license key: the CLI has no paid
code to unlock. It works forever, offline, without an account.

## What is Pro (hosted service, separate private codebase)

Pro is a **service**, not a software edition. The paid value is hosting,
history, and multi-project/multi-person organization — things a local CLI
cannot provide by nature:

| Feature | Why it is Pro |
|---|---|
| PM/PO dashboard — compliance per team, project, feature; 30/90-day trends | Requires a server, a database, and reports from many repos |
| Audit-to-audit diff on PRs ("this PR adds 3 violations, fixes 7") | Requires stored history with stable fingerprints |
| RGAA compliance statement export (déclaration d'accessibilité) | Generated from the stored audit history |
| Centralized policies (`--remote`): org-wide gate thresholds, rule sets | One config pushed to every repo instead of N divergent files |
| Scheduled crawls of production URLs, Slack/Teams alerts | Runs on our infrastructure, not in your CI |
| MCP governance: usage logs, per-token quotas | Aggregation across developers and agents |
| SSO, roles (viewer / developer / admin), unlimited retention | Account and org management |

The Pro backend lives in a private repository. This split keeps the incentive
honest: we cannot make the open-source tool worse to sell the service,
because the service's value is precisely what local software cannot do.

## How the two sides talk: the report contract

The CLI is a **sensor**. Its only Pro-facing surface is a small HTTP client
([`packages/cli/src/services/api.ts`](../packages/cli/src/services/api.ts))
that pulls configuration and pushes reports. All SaaS logic (dashboards,
scoring history, PDF generation) is server-side and intentionally absent from
this codebase.

The contract is the **audit payload** — the exact JSON printed by
`axaraaudit audit --format json`, defined in
[`packages/core/src/project/payload.ts`](../packages/core/src/project/payload.ts)
and versioned via `payloadVersion` (currently `2`). The same shape is
produced by the CLI, the MCP server, and accepted by the Pro API.

```
AuditPayload {
  tool, toolVersion, payloadVersion, generatedAt, project,
  score,                     // 0–100
  scores: { design, rgaa },  // per-source sub-scores, same 0–100 scale (v2)
  gate:  { evaluated, passed, failUnder, reasons },
  drift: { summary, tokenErrors, issues[] },   // each issue carries `fingerprint`
  rgaa:  { enabled, aggregate, findings[] }    // each finding carries `fingerprint`
}
```

**Score scale (v2).** The score maps the penalty sum linearly (`100 − penalty`)
while the penalty stays ≤ 50, then switches to a hyperbolic tail
(`2500 / penalty`, value- and slope-continuous at the junction). Scores ≥ 50
are therefore identical to the historical v1 scale; below that, a heavily
failing project keeps a small non-zero score that still moves when violations
are fixed, instead of being clamped flat at 0. The `scores.design` /
`scores.rgaa` sub-scores apply the same scale to each pressure source in
isolation, so progress on one front stays visible even when the other
dominates the global score.

### Violation fingerprints

Every drift issue and RGAA finding carries a `fingerprint`: a 16-hex-char
stable identity (`packages/core/src/project/fingerprint.ts`). It hashes the
root-relative file path (POSIX separators), the rule identity (token
category + CSS property + offending value for drift; RGAA criterion + axe
rule for findings) and an occurrence rank for exact duplicates — never line
numbers, absolute paths, or localized messages. The same violation therefore
keeps the same fingerprint across commits that merely shift code, across
machines, and across display languages. This is what lets the dashboard
classify each violation as **new / persistent / fixed** between two audits.

### Endpoints

Base URL: `https://api.axara.dev` (override with `pro.apiUrl` in
`.auditorrc.json` or `--api-url` at login). Authentication: project or
personal token, `Authorization: Bearer <token>`. Tokens come from
`AUDITOR_TOKEN` (CI-friendly, never written to disk) or
`axaraaudit login --token …` (`~/.axaraaudit/credentials.json`).

| Endpoint | Used by | Purpose |
|---|---|---|
| `GET /v1/me` | `login`, `whoami` | Identify the token owner (name, organization, plan) |
| `GET /v1/config` | `audit --remote` | Pull org rules and, optionally, an inline DTCG token document |
| `POST /v1/reports` | `push`, `audit --upload` | Ingest an audit payload; answers `{ id?, url? }` |

Because the payload schema and endpoints are documented here in the open
repository, a future self-hosted Enterprise backend — or your own internal
collector — can implement the same contract.

### Sending reports

```bash
# One-shot: audit and send
axaraaudit push

# Send a report produced earlier (e.g. a CI artifact)
axaraaudit audit --format json --out report.json
axaraaudit push report.json

# Inspect what would be sent, without a token and without network
axaraaudit push --dry-run

# Equivalent inline form during an audit
axaraaudit audit --upload
```

A cloud outage never breaks a local audit: `audit --upload` warns and
continues; `push`, whose sole purpose is uploading, exits `2` on failure.

## Design rules for contributors

1. **All audit logic goes in `core`** — never behind a token check. If a rule
   or fix works locally, it ships free.
2. **The CLI never embeds SaaS logic.** It builds payloads and talks to the
   API; rendering dashboards, aggregating orgs, or generating legal documents
   happens server-side.
3. **The payload is a public, versioned contract.** Breaking changes bump
   `payloadVersion`; the API accepts older versions during a deprecation
   window.
4. **No dark patterns.** No telemetry in the free path, no nagging, no
   artificial limits. The upsell is a real capability, or it does not exist.
