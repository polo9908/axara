# AxaraAudit — plugin Claude Code

Le plugin qui rend le code UI de Claude **accessible et token-correct par
construction** : chaque fichier React/Vue/HTML/CSS écrit par l'agent est validé
en temps réel (RGAA 4.1 + design drift), et les violations lui sont renvoyées
immédiatement pour auto-correction — avant même que vous relisiez le diff.

## Installation

```
/plugin marketplace add polo9908/axara
/plugin install axara-audit@axara
```

## Ce que le plugin installe

| Composant | Rôle |
|---|---|
| **Hook `PostToolUse`** (`Edit\|Write`) | Lance `axaraaudit check` sur chaque fichier UI modifié ; en cas de violation, renvoie la liste à Claude avec l'instruction de corriger. Silencieux quand tout est conforme. |
| **Serveur MCP `axara`** | Les 5 tools (`get_design_system_rules`, `validate_component_code`, `audit_project`, `fix_drift`, `explain_rule`) + resources, via `npx -y @axaraaudit/mcp-server`. |
| **Skill `axara`** | Les règles de génération (tokens `var(--…)`, ARIA, anti-patterns) chargées quand Claude travaille sur de l'UI. |

## Comment ça marche

1. Claude écrit `Header.tsx` avec `color: '#6366f1'` et une `<img>` sans `alt`.
2. Le hook exécute `axaraaudit check Header.tsx --format json` (< 1 s en local).
3. Claude reçoit :
   ```
   AxaraAudit : 2 problème(s) d'accessibilité/design system dans Header.tsx :
   - RGAA 1.1 (critical) : Chaque image porteuse d'information a-t-elle une alternative textuelle ?
   - L12 color: #6366f1 → remplace par var(--color-brand-primary)
   Corrige ce fichier immédiatement…
   ```
4. Claude corrige, le hook revalide : silence = conforme.

## Résolution du CLI

Le hook cherche AxaraAudit dans cet ordre :

1. `$AXARA_CLI` — chemin explicite vers `dist/index.js` du CLI (dev/monorepo) ;
2. `node_modules/@axaraaudit/cli` du projet (recommandé : `npm i -D @axaraaudit/cli`) ;
3. `npx -y @axaraaudit/cli` (universel, plus lent au premier appel).

**Fail-open** : si le CLI est introuvable ou plante, le hook se tait — il ne
casse jamais une session de travail.

## Configuration

Le hook respecte le `.auditorrc.json` du projet (extensions, exclusions, scope
RGAA, tokens). Sans design system détecté, la validation RGAA reste active
(drift désactivé). Sans configuration du tout, les conventions par défaut
s'appliquent — zéro config nécessaire.
