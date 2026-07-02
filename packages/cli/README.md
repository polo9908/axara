# @axaraaudit/cli

CLI d'audit **open-core** : conformité design-system (tokens DTCG) + accessibilité **RGAA 4.1 / WCAG**.

- **Open source (local)** — analyse statique, rapport terminal/JSON, auto-fix. Aucune donnée ne quitte la machine.
- **Pro (passerelle cloud)** — synchronisation distante des règles/tokens, upload des rapports vers le dashboard, gatekeeper CI. La CLI n'est qu'un **capteur** : toute la logique SaaS (dashboards, PDF de conformité, historique) vit côté serveur.

```bash
pnpm add -D @axaraaudit/cli
npx axaraaudit init      # génère .auditorrc.json
npx axaraaudit audit     # rapport terminal
npx axaraaudit fix --write
```

## Commandes

| Commande | Rôle | Niveau |
|---|---|---|
| `audit` | Analyse dérives de tokens + RGAA (défaut) | Open source |
| `fix [--write]` | Applique les corrections sûres (dry-run par défaut) | Open source |
| `init [--force]` | Génère un `.auditorrc.json` de démarrage | Open source |
| `login --token <t>` | Enregistre un jeton Pro (`~/.axaraaudit/credentials.json`) | Pro |
| `logout` / `whoami` | Gestion du jeton | Pro |

## Options d'audit

| Flag | Effet |
|---|---|
| `--format pretty\|json` | Sortie stylisée (défaut) ou payload JSON stable |
| `--out <fichier>` | Écrit aussi le rapport JSON sur disque |
| `--ci` | **Gatekeeper** : `exit 1` si score < seuil ou critère RGAA bloquant |
| `--fail-under <n>` | Seuil de score local (défaut : `ci.failUnder`, 80) |
| `--skip-rgaa` | Dérive design uniquement |
| `--remote` | Récupère règles + tokens depuis l'API Pro (bypass du fichier local) |
| `--upload` | Envoie le rapport JSON à l'API Pro |
| `--config` / `--tokens` | Chemins explicites |

Variable d'environnement : `AUDITOR_TOKEN` (prioritaire, idéale en CI — jamais écrite sur disque).

## `.auditorrc.json`

```jsonc
{
  "project": "mon-app",
  "tokens": "./design-tokens.dtcg.json",   // document DTCG (source de vérité)
  "include": ["src", "components", "styles"],
  "exclude": ["node_modules", "dist", ".next"],
  "extensions": [".css", ".scss", ".tsx", ".jsx", ".html"],
  "remBasePx": 16,
  "rgaa": {
    "enabled": true,
    "scope": "component",        // "component" = ignore les règles de page (h1, landmarks)
    "contrast": false,           // le contraste fiable nécessite un vrai layout (runtime Playwright)
    "priority": ["1.1", "3.2", "11.1"]  // critères bloquants pour le gate, quel que soit l'impact
  },
  "ci": {
    "failUnder": 80,             // score minimal 0–100
    "blockOnCritical": true      // toute violation critical/serious bloque le pipeline
  },
  "pro": {
    "apiUrl": "https://api.axara.dev",
    "upload": false,             // pousser chaque rapport vers le dashboard
    "remoteConfig": false        // tirer règles/tokens depuis l'API au lieu du local
  }
}
```

Le score (0–100) pondère les violations RGAA (critical −10 … minor −2) plus lourdement
que les dérives de tokens (erreur −2, avertissement −0,5). C'est un signal de pression
CI, **pas** un taux de conformité légal (qui exige un audit manuel).

## Exemple GitHub Actions

```yaml
- name: Audit accessibilité & design system
  run: npx axaraaudit audit --ci --format json --out audit-report.json
  env:
    AUDITOR_TOKEN: ${{ secrets.AUDITOR_TOKEN }}   # optionnel (Pro)
```

## Contrat API (Pro)

La CLI ne connaît que trois routes, toutes authentifiées par `Authorization: Bearer` :

| Route | Usage |
|---|---|
| `GET /v1/config` | `{ config?: PartialRc, tokens?: DtcgDocument }` — règles/tokens distants |
| `POST /v1/reports` | Reçoit le payload JSON du rapport (`payloadVersion: 1`) |
| `GET /v1/me` | Identité du jeton (`login` / `whoami`) |

Une panne cloud ne casse jamais l'audit local : l'upload échoue en avertissement,
le gate CI est évalué sur le résultat local.
