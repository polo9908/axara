#!/usr/bin/env node
/**
 * axaraaudit — alias exécutable de @axaraaudit/cli.
 *
 * Le vrai CLI vit dans @axaraaudit/cli (packages/cli) ; ce package ne sert
 * qu'à faire fonctionner `npx axaraaudit <commande>` tel que documenté,
 * sans devoir taper le scope. L'entrée du CLI lance main() à l'import.
 */
import '@axaraaudit/cli';
