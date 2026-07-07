---
name: axara
description: Règles AxaraAudit pour générer du code UI conforme RGAA 4.1 et fidèle au design system (tokens DTCG). Utiliser avant de créer ou modifier des composants React/Vue/HTML/CSS, ou quand l'utilisateur parle d'accessibilité, de design tokens ou de score AxaraAudit.
---

# AxaraAudit — UI conforme par construction

Ce projet est audité par AxaraAudit (accessibilité RGAA 4.1 + cohérence design system). Un hook valide automatiquement chaque fichier UI que tu écris : si tu reçois un retour « AxaraAudit : N problème(s)… », corrige le fichier immédiatement avant de continuer.

## Règles de génération

1. **Tokens d'abord** — Aucune couleur ni aucun espacement en dur. Référence les design tokens via `var(--token)`. La source de vérité est `design-tokens.dtcg.json` (ou les custom properties CSS du projet). Si le serveur MCP `axara` est connecté, appelle `get_design_system_rules` pour la liste exacte ; sinon lis le fichier de tokens.

2. **Accessibilité native** — Éléments HTML sémantiques avant tout rôle ARIA. Toujours : `alt` sur les images informatives (`alt=""` si décorative), `<label>` associé à chaque champ, nom accessible sur liens et boutons, hiérarchie de titres cohérente.

3. **Valide ce que tu produis** — Après avoir écrit ou modifié un fichier UI :
   ```bash
   npx axaraaudit check <fichier> --format json
   ```
   Exit 0 = conforme ; exit 1 = corrige puis relance. Pour l'état global du projet : `npx axaraaudit audit` (score 0–100). Pour appliquer les remplacements de tokens sûrs : `npx axaraaudit fix --write`.

4. **Critère RGAA inconnu ?** — Le tool MCP `explain_rule` (ex. `{ "criterion": "11.1" }`) donne l'intitulé officiel, les références WCAG et les règles axe-core associées.

## Anti-patterns à refuser

- `color: #6366f1` → `color: var(--color-brand-primary)`
- `padding: 16px` → `padding: var(--space-4)`
- `<img src="x.png">` → `<img src="x.png" alt="…">`
- `<input type="email">` seul → l'associer à un `<label>`
- `<div onClick=…>` → `<button>`
