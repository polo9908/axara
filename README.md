# AxaraAudit

**Vérificateur automatique d'accessibilité et de cohérence de design system.**

AxaraAudit analyse ton code et te dit :
- Les couleurs/espacements codés en dur qui devraient utiliser tes tokens design (`#6366f1` → `var(--color-brand-primary)`)
- Les violations d'accessibilité RGAA 4.1 / WCAG (images sans alt, inputs sans label, pièges clavier…)
- Un score de conformité 0–100 pour bloquer ton pipeline CI si la qualité baisse

> **Modèle Open-Core** : l'audit local est 100% gratuit et open source. Les fonctionnalités cloud (dashboard, sync distante, historique) sont Pro.

---

## Installation

Une seule commande, dans le dossier de ton projet :

```bash
npm install -D @axaraaudit/cli
```

> 💡 **npm, pnpm, npx — c'est quoi la différence ?**
> - `npm install` **installe** le package dans ton projet (une seule fois)
> - `npx axaraaudit ...` **exécute** la commande installée (à chaque usage)
> - Si ton projet utilise **pnpm**, remplace simplement : `pnpm add -D @axaraaudit/cli` puis `pnpm exec axaraaudit ...` — le comportement est identique.
>
> Toutes les commandes ci-dessous utilisent `npx`, qui fonctionne dans tous les cas.

---

## Démarrage rapide

### 1. Initialiser la configuration

```bash
npx axaraaudit init
```

Crée un fichier `.auditorrc.json` à la racine du projet :

```json
{
  "project": "mon-app",
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

### 2. Lancer l'audit

```bash
npx axaraaudit audit
```

```
  AXARA AUDIT — mon-app
  5 fichier(s) analysé(s)
────────────────────────────────────────────────────────────────
  DESIGN SYSTEM
  components/Header.tsx
    L12  background-color  #6366f1 → var(--color-brand-primary)  [auto-fix]
    L12  padding           16px → var(--space-4)                  [auto-fix]
────────────────────────────────────────────────────────────────
  RGAA 4.1
    ✖ 1.1  Image sans alternative textuelle  (critical)
    ✖ 11.1 Input sans label associé          (serious)
────────────────────────────────────────────────────────────────
  SCORE  76/100
```

### 3. Corriger automatiquement les dérives design

Les couleurs et espacements qui correspondent exactement à un token peuvent être corrigés automatiquement.

```bash
# Prévisualisation (ne modifie rien)
npx axaraaudit fix

# Appliquer les corrections
npx axaraaudit fix --write
```

Avant :
```css
background-color: #6366f1;
padding: 16px 32px;
```

Après :
```css
background-color: var(--color-brand-primary);
padding: var(--space-4) var(--space-8);
```

> ⚠️ Les violations RGAA (alt manquant, label absent…) ne sont **pas** auto-corrigées : elles demandent un choix de conception humain.

---

## Toutes les commandes

### `axaraaudit audit` — Analyse complète

```bash
# Rapport terminal (défaut)
npx axaraaudit audit

# Exporter le rapport en JSON
npx axaraaudit audit --format json
npx axaraaudit audit --out rapport.json

# Analyser seulement les dérives design (sans RGAA)
npx axaraaudit audit --skip-rgaa

# Mode CI : bloque avec exit code 1 si score < seuil
npx axaraaudit audit --ci

# Définir un seuil de score personnalisé
npx axaraaudit audit --ci --fail-under 90

# Utiliser un fichier de config ou tokens différent
npx axaraaudit audit --config ./config/audit.json
npx axaraaudit audit --tokens ./tokens/brand.dtcg.json
```

### `axaraaudit fix` — Correction automatique

```bash
# Prévisualisation (ne modifie rien)
npx axaraaudit fix

# Appliquer les corrections aux fichiers
npx axaraaudit fix --write
```

Ce qui est corrigé automatiquement :
- ✅ Couleur codée en dur = valeur exacte d'un token
- ✅ Espacement codé en dur = valeur exacte d'un token

Ce qui n'est pas touché :
- ❌ Valeur "proche" d'un token (ex: `#5a5fcf` ≈ `#6366f1`) — à toi de décider
- ❌ Violations RGAA — exigent un choix humain

### `axaraaudit init` — Initialisation

```bash
# Créer .auditorrc.json
npx axaraaudit init

# Écraser un fichier existant
npx axaraaudit init --force
```

### `axaraaudit login` — Authentification Pro

```bash
# Enregistrer un jeton Pro
npx axaraaudit login --token <ton-jeton>

# Vérifier l'identité
npx axaraaudit whoami

# Se déconnecter
npx axaraaudit logout
```

En CI, utilise plutôt la variable d'environnement (jamais écrite sur disque) :

```bash
AUDITOR_TOKEN=<ton-jeton> npx axaraaudit audit --ci --upload
```

---

## Intégration CI/CD

### GitHub Actions

```yaml
name: Audit accessibilité & design system
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
          AUDITOR_TOKEN: ${{ secrets.AUDITOR_TOKEN }}   # optionnel (Pro)
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: audit-report
          path: audit-report.json
```

### Codes de sortie

| Code | Signification |
|---|---|
| `0` | Audit OK (ou mode non-CI) |
| `1` | Gate CI échoué (score < seuil ou critère bloquant) |
| `2` | Erreur de configuration |

---

## Le fichier `.auditorrc.json` en détail

```jsonc
{
  // Nom du projet (affiché dans le rapport)
  "project": "mon-app",

  // Fichier de tokens au format DTCG (source de vérité design)
  "tokens": "./design-tokens.dtcg.json",

  // Dossiers/fichiers à analyser
  "include": ["src", "components", "styles"],
  "exclude": ["node_modules", "dist", "build", ".next"],
  "extensions": [".css", ".scss", ".tsx", ".jsx", ".html"],

  // Base rem → px pour normaliser les espacements
  "remBasePx": 16,

  "rgaa": {
    "enabled": true,
    // "component" ignore les règles de page (h1, landmarks) pour les composants isolés
    // "page" pour auditer une page HTML complète
    "scope": "component",
    // Critères RGAA qui bloquent le CI quel que soit l'impact
    "priority": ["1.1", "3.2", "11.1"]
  },

  "ci": {
    // Score minimal 0–100 pour passer le gate
    "failUnder": 80,
    // Bloquer sur toute violation critical ou serious
    "blockOnCritical": true
  },

  // Fonctionnalités Pro
  "pro": {
    "apiUrl": "https://api.axara.dev",
    "upload": false,       // envoyer chaque rapport au dashboard
    "remoteConfig": false  // récupérer règles/tokens depuis l'API
  }
}
```

---

## Format des tokens (`design-tokens.dtcg.json`)

Format standard [DTCG](https://design-tokens.github.io/community-group/format/) :

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

Les tokens génèrent automatiquement des variables CSS en kebab-case :
- `color.brand.primary` → `var(--color-brand-primary)`
- `space.8` → `var(--space-8)`

---

## Packages du monorepo

| Package | Rôle |
|---|---|
| [`@axaraaudit/core`](packages/core/README.md) | Moteur : parsing DTCG, analyse AST, RGAA/axe-core, auto-fix |
| [`@axaraaudit/cli`](packages/cli/README.md) | CLI `axaraaudit` (ce que tu utilises au quotidien) |
| [`@axaraaudit/runtime`](packages/runtime/README.md) | Playwright : détection pièges clavier + sync Figma Variables |
| [`@axaraaudit/mcp-server`](packages/mcp-server/README.md) | Serveur MCP pour intégration dans Claude/LLM |

---

## Développement

```bash
# Cloner et installer
git clone https://github.com/polo9908/axara.git
cd axara
pnpm install

# Build de tous les packages
pnpm -r build

# Lancer les tests (118 tests)
pnpm -r test

# Typecheck strict
pnpm -r typecheck

# Tester la CLI directement depuis les sources
node packages/cli/dist/index.js audit
```

---

## Prérequis

- Node.js ≥ 20
- pnpm 10

## Licence

MIT
