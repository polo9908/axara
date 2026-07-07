/**
 * `axaraaudit help [commande]` — l'aide, repensée pour la découverte.
 *
 * Une source de vérité unique (CATALOG) décrit chaque commande : définition
 * courte, usage, options, exemples et « étape suivante » logique. Elle
 * alimente :
 *   - l'aide globale, groupée par intention (diagnostiquer → corriger →
 *     explorer → configurer) ;
 *   - l'aide par commande (`axaraaudit fix --help` ou `help fix`) ;
 *   - la suggestion « vouliez-vous dire ? » sur commande inconnue.
 */

import { boldOn, gradient, paintFg, reset, stdoutLevel, type ColorLevel } from '../ui/ansi.js';
import { BRAND } from '../ui/theme.js';
import { CLI_NAME, CLI_VERSION } from '../version.js';

export interface CommandSpec {
  readonly name: string;
  /** Définition en une ligne : ce que fait la commande, pour qui. */
  readonly brief: string;
  readonly usage: string;
  readonly options?: readonly (readonly [flag: string, doc: string])[];
  readonly examples?: readonly (readonly [cmd: string, doc: string])[];
  /** Commandes qui suivent naturellement — affichées dans l'aide détaillée. */
  readonly next?: readonly string[];
}

interface CommandGroup {
  readonly icon: string;
  readonly title: string;
  readonly commands: readonly CommandSpec[];
}

export const GROUPS: readonly CommandGroup[] = [
  {
    icon: '🔍',
    title: 'DIAGNOSTIQUER',
    commands: [
      {
        name: 'audit',
        brief: 'Analyse le projet : dérives de tokens + RGAA 4.1, score /100',
        usage: 'axaraaudit audit [options]',
        options: [
          ['--format pretty|json|html', 'format de sortie (html : rapport autonome partageable)'],
          ['--out <fichier>', 'écrit le rapport (JSON ou HTML) dans un fichier'],
          ['--ci', 'mode gatekeeper : exit 1 si le gate échoue'],
          ['--fail-under <0-100>', 'seuil de score (défaut : config ou 80)'],
          ['--skip-rgaa', "ne lance que l'analyse de dérive design"],
          ['--config <chemin>', 'fichier .auditorrc.json explicite'],
          ['--tokens <chemin>', 'fichier de tokens DTCG (bypass de la config)'],
          ['--remote / --upload', 'sync règles / envoi du rapport (jeton Pro)'],
        ],
        examples: [
          ['axaraaudit audit', 'rapport complet dans le terminal'],
          ['axaraaudit audit --format html', 'rapport HTML à partager'],
          ['axaraaudit audit --ci --fail-under 90', 'gate de pipeline CI'],
        ],
        next: ['fix', 'voice', 'history'],
      },
      {
        name: 'check',
        brief: 'Valide des fichiers précis — pensé pour hooks IA et pre-commit',
        usage: 'axaraaudit check <fichier...> [--format json]',
        options: [
          ['--format pretty|json', 'json : sortie machine (hooks, CI)'],
        ],
        examples: [
          ['axaraaudit check src/Header.tsx', 'exit 0 conforme, 1 sinon'],
        ],
        next: ['fix'],
      },
    ],
  },
  {
    icon: '🛠',
    title: 'CORRIGER',
    commands: [
      {
        name: 'fix',
        brief: 'Applique les corrections — sûres par défaut, IA en option',
        usage: 'axaraaudit fix [--write] [--all] [--ai]',
        options: [
          ['--write', 'persiste les corrections (sinon : prévisualisation)'],
          ['--all', 'inclut les tokens proches (--min-confidence <0..1>, défaut 0.7)'],
          ['--ai', 'délègue le reste (RGAA, valeurs sans token) à Claude'],
          ['--model <id>', 'modèle IA (défaut : claude-opus-4-8)'],
        ],
        examples: [
          ['axaraaudit fix', 'prévisualisation, rien n\'est modifié'],
          ['axaraaudit fix --write', 'applique les remplacements 100 % sûrs'],
          ['axaraaudit fix --ai --write', 'corrige aussi alt, labels, titres… via Claude'],
        ],
        next: ['audit'],
      },
      {
        name: 'init',
        brief: 'Génère un .auditorrc.json de démarrage',
        usage: 'axaraaudit init [--force]',
        options: [['--force', 'écrase un fichier existant']],
        next: ['audit'],
      },
    ],
  },
  {
    icon: '🎧',
    title: 'EXPLORER & RESSENTIR',
    commands: [
      {
        name: 'voice',
        brief: "Simule un lecteur d'écran : entendez vos composants comme un utilisateur aveugle",
        usage: 'axaraaudit voice [fichier...]',
        examples: [['axaraaudit voice src/Header.tsx', 'annonce le composant, signale les trous']],
        next: ['fix'],
      },
      {
        name: 'history',
        brief: "Rejoue l'audit sur les derniers commits et trace l'évolution du score",
        usage: 'axaraaudit history [--limit <n>]',
        options: [['--limit <n>', 'nombre de commits (défaut 15)']],
        next: ['blame', 'fix'],
      },
      {
        name: 'blame',
        brief: 'Attribue chaque dérive à son auteur (git blame)',
        usage: 'axaraaudit blame',
        next: ['fix'],
      },
      {
        name: 'roast',
        brief: "L'audit commenté par un humoriste — cinglant mais bienveillant (clé IA requise)",
        usage: 'axaraaudit roast [--model <id>]',
        next: ['fix'],
      },
      {
        name: 'hello',
        brief: 'Rencontrez Axa, la mascotte, et la charte graphique du CLI',
        usage: 'axaraaudit hello [--demo]',
        options: [['--demo', 'rejoue un audit animé — idéal pour un GIF']],
        next: ['audit'],
      },
    ],
  },
  {
    icon: '⚙️',
    title: 'CONFIGURATION & COMPTE',
    commands: [
      {
        name: 'login',
        brief: 'Enregistre un jeton Pro et/ou une clé Anthropic (active fix --ai)',
        usage: 'axaraaudit login [--token <jeton>] [--anthropic-key <clé>]',
        options: [
          ['--token <jeton>', 'jeton Pro (--remote, --upload, --ci gate cloud)'],
          ['--anthropic-key <clé>', 'clé API Anthropic pour fix --ai et roast'],
        ],
        next: ['fix'],
      },
      { name: 'logout', brief: 'Supprime le jeton enregistré', usage: 'axaraaudit logout' },
      { name: 'whoami', brief: "Affiche l'identité liée au jeton", usage: 'axaraaudit whoami' },
      {
        name: 'help',
        brief: "Cette aide — ou l'aide détaillée d'une commande",
        usage: 'axaraaudit help [commande]',
        examples: [['axaraaudit help fix', 'options et exemples de `fix`']],
      },
    ],
  },
] as const;

const ALL: readonly CommandSpec[] = GROUPS.flatMap((g) => g.commands);

export function findCommand(name: string): CommandSpec | undefined {
  return ALL.find((c) => c.name === name);
}

// ── « Vouliez-vous dire ? » ────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j] as number;
      row[j] = Math.min(
        tmp + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[n] as number;
}

/** Meilleure suggestion pour une commande inconnue (distance ≤ 3), sinon undefined. */
export function didYouMean(input: string): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const { name } of ALL) {
    const distance = levenshtein(input.toLowerCase(), name);
    if (best === undefined || distance < best.distance) best = { name, distance };
  }
  return best !== undefined && best.distance <= 3 ? best.name : undefined;
}

// ── Rendu ──────────────────────────────────────────────────────────────────

function b(text: string, level: ColorLevel): string {
  return level === 'none' ? text : `${boldOn(level)}${text}${reset(level)}`;
}

const PAD = 10; // largeur de la colonne « nom de commande » dans l'aide globale

/** Aide globale : groupes par intention, une ligne par commande. */
export function renderHelp(level: ColorLevel = stdoutLevel): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${gradient(`${CLI_NAME} v${CLI_VERSION}`, BRAND.violet, BRAND.cyan, level)} ${paintFg('— audit design-system + RGAA 4.1, dès le terminal', BRAND.slate, level)}`);
  lines.push('');
  lines.push(`  ${b('USAGE', level)}  ${paintFg(`${CLI_NAME} <commande> [options]`, BRAND.cyan, level)}`);

  for (const group of GROUPS) {
    lines.push('');
    lines.push(`  ${group.icon} ${b(group.title, level)}`);
    for (const cmd of group.commands) {
      lines.push(
        `    ${paintFg(cmd.name.padEnd(PAD), BRAND.cyan, level)} ${paintFg(cmd.brief, BRAND.slate, level)}`,
      );
    }
  }

  lines.push('');
  lines.push(`  ${b('DÉMARRAGE EXPRESS', level)}`);
  lines.push(`    ${paintFg('axaraaudit audit', BRAND.cyan, level)}              ${paintFg('→ votre premier rapport, zéro config', BRAND.slate, level)}`);
  lines.push(`    ${paintFg('axaraaudit fix --write', BRAND.cyan, level)}        ${paintFg('→ applique les corrections sûres', BRAND.slate, level)}`);
  lines.push('');
  lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${paintFg('Aide détaillée : ', BRAND.slate, level)}${paintFg('axaraaudit help <commande>', BRAND.cyan, level)}${paintFg('  ·  codes de sortie : 0 ok, 1 gate échoué, 2 erreur d\'usage', BRAND.slate, level)}`);
  lines.push('');
  return lines.join('\n');
}

/** Aide détaillée d'une commande : usage, options, exemples, étape suivante. */
export function renderCommandHelp(spec: CommandSpec, level: ColorLevel = stdoutLevel): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${gradient(`axaraaudit ${spec.name}`, BRAND.violet, BRAND.cyan, level)} ${paintFg(`— ${spec.brief}`, BRAND.slate, level)}`);
  lines.push('');
  lines.push(`  ${b('USAGE', level)}     ${paintFg(spec.usage, BRAND.cyan, level)}`);

  if (spec.options !== undefined && spec.options.length > 0) {
    lines.push('');
    lines.push(`  ${b('OPTIONS', level)}`);
    const width = Math.max(...spec.options.map(([flag]) => flag.length));
    for (const [flag, doc] of spec.options) {
      lines.push(`    ${paintFg(flag.padEnd(width), BRAND.cyan, level)}  ${paintFg(doc, BRAND.slate, level)}`);
    }
  }

  if (spec.examples !== undefined && spec.examples.length > 0) {
    lines.push('');
    lines.push(`  ${b('EXEMPLES', level)}`);
    const width = Math.max(...spec.examples.map(([cmd]) => cmd.length));
    for (const [cmd, doc] of spec.examples) {
      lines.push(`    ${paintFg('$', BRAND.pink, level)} ${paintFg(cmd.padEnd(width), BRAND.cyan, level)}  ${paintFg(doc, BRAND.slate, level)}`);
    }
  }

  if (spec.next !== undefined && spec.next.length > 0) {
    const chain = spec.next.map((n) => paintFg(`axaraaudit ${n}`, BRAND.cyan, level)).join(paintFg('  ·  ', BRAND.slate, level));
    lines.push('');
    lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${paintFg('Suite logique :', BRAND.slate, level)} ${chain}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Point d'entrée de `axaraaudit help [commande]`. */
export function runHelp(argv: readonly string[]): number {
  const target = argv[0];
  if (target !== undefined && !target.startsWith('-')) {
    const spec = findCommand(target);
    if (spec === undefined) {
      const suggestion = didYouMean(target);
      process.stderr.write(
        `Commande inconnue : ${target}${suggestion !== undefined ? ` — vouliez-vous dire \`${suggestion}\` ?` : ''}\n`,
      );
      process.stdout.write(renderHelp());
      return 2;
    }
    process.stdout.write(renderCommandHelp(spec));
    return 0;
  }
  process.stdout.write(renderHelp());
  return 0;
}
