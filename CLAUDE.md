# AxaraAudit — repères pour Claude Code

Moteur d'audit accessibilité (RGAA 4.1/WCAG) + dérive design-tokens (DTCG). Open-core : audit local gratuit, cloud Pro. Monorepo pnpm, TypeScript strict, ESM, Node ≥ 20.

## Commandes

```bash
pnpm -r build                      # build tous les packages
pnpm -r test                       # vitest (tous)
pnpm --filter @axaraaudit/cli test # un seul package (préférer en itération)
pnpm -r typecheck
node packages/cli/dist/index.js audit   # lancer le CLI depuis les sources
```

Toujours builder avant de lancer le CLI (pas de ts-node/tsx).

## Architecture

- `packages/core` — moteur partagé : parsing DTCG, analyse AST, règles RGAA/axe-core, auto-fix, score, `.auditorrc.json` (`loadRc`). **Toute logique d'audit vit ici**, jamais dans cli/mcp-server.
- `packages/cli` — CLI `axaraaudit`/`axa`. Entrée `src/index.ts` (dispatch), commandes dans `src/commands/`, UI ANSI zéro-dépendance dans `src/ui/` (palette interactive, thème, gradient). Sans argument sur TTY → palette bouclée (Échap quitte).
- `packages/axaraaudit` — alias npm non scopé (`bin.js` réimporte `@axaraaudit/cli`) pour `npx axaraaudit`. Versionner en même temps que cli.
- `packages/mcp-server` — 5 tools / 3 resources MCP, même moteur core.
- `packages/runtime` — Playwright (pièges clavier, sync Figma).
- `claude-plugin/` — plugin Claude Code : hook PostToolUse → `axaraaudit check`, MCP bundlé, skill.

## Conventions

- Messages utilisateur du CLI **en français** ; code/commentaires bilingues (suivre le fichier).
- CLI et core : **zéro dépendance runtime** (Node stdlib + `parseArgs`). Ne pas ajouter commander/chalk/etc.
- Exit codes : 0 conforme, 1 gate/violations, 2 erreur de config.
- Nouvelle commande CLI = 4 endroits : `src/commands/<nom>.ts`, switch de `src/index.ts`, `GROUPS` dans `src/commands/help.ts` (alimente aide + palette), tests vitest à côté du source (`*.test.ts`).

## Publication

Packages publics : `@axaraaudit/core`, `@axaraaudit/cli`, `axaraaudit`, `@axaraaudit/mcp-server`. `cli` et `axaraaudit` partagent toujours la même version ; core/mcp-server suivent leur propre rythme. Bump les package.json concernés, puis `pnpm -r build && pnpm -r test`, commit, `pnpm publish -r --access public` (gère workspace:* → versions réelles). Push GitHub : remote `origin` = polo9908/axara, branche `main`.
