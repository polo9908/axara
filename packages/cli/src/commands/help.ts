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
import { tr } from '../i18n.js';
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
    title: tr('DIAGNOSTIQUER', 'DIAGNOSE'),
    commands: [
      {
        name: 'audit',
        brief: tr(
          'Analyse le projet : dérives de tokens + RGAA 4.1, score /100',
          'Analyzes the project: token drift + RGAA 4.1, score /100',
        ),
        usage: 'axaraaudit audit [options]',
        options: [
          [
            '--format pretty|json|html',
            tr(
              'format de sortie (html : rapport autonome partageable)',
              'output format (html: self-contained, shareable report)',
            ),
          ],
          [
            tr('--out <fichier>', '--out <file>'),
            tr(
              'écrit le rapport (JSON ou HTML) dans un fichier',
              'writes the report (JSON or HTML) to a file',
            ),
          ],
          ['--ci', tr('mode gatekeeper : exit 1 si le gate échoue', 'gatekeeper mode: exit 1 if the gate fails')],
          [
            '--fail-under <0-100>',
            tr('seuil de score (défaut : config ou 80)', 'score threshold (default: config or 80)'),
          ],
          [
            '--skip-rgaa',
            tr("ne lance que l'analyse de dérive design", 'only runs the design drift analysis'),
          ],
          [
            tr('--config <chemin>', '--config <path>'),
            tr('fichier .auditorrc.json explicite', 'explicit .auditorrc.json file'),
          ],
          [
            tr('--tokens <chemin>', '--tokens <path>'),
            tr('fichier de tokens DTCG (bypass de la config)', 'DTCG tokens file (bypasses the config)'),
          ],
          [
            '--remote / --upload',
            tr('sync règles / envoi du rapport (jeton Pro)', 'rule sync / report upload (Pro token)'),
          ],
        ],
        examples: [
          ['axaraaudit audit', tr('rapport complet dans le terminal', 'full report in the terminal')],
          ['axaraaudit audit --format html', tr('rapport HTML à partager', 'shareable HTML report')],
          ['axaraaudit audit --ci --fail-under 90', tr('gate de pipeline CI', 'CI pipeline gate')],
        ],
        next: ['fix', 'voice', 'history'],
      },
      {
        name: 'check',
        brief: tr(
          'Valide des fichiers précis — pensé pour hooks IA et pre-commit',
          'Validates specific files — built for AI hooks and pre-commit',
        ),
        usage: tr(
          'axaraaudit check <fichier...> [--format json]',
          'axaraaudit check <file...> [--format json]',
        ),
        options: [
          ['--format pretty|json', tr('json : sortie machine (hooks, CI)', 'json: machine output (hooks, CI)')],
        ],
        examples: [
          [
            'axaraaudit check src/Header.tsx',
            tr('exit 0 conforme, 1 sinon', 'exit 0 if compliant, 1 otherwise'),
          ],
        ],
        next: ['fix'],
      },
    ],
  },
  {
    icon: '🛠',
    title: tr('CORRIGER', 'FIX'),
    commands: [
      {
        name: 'fix',
        brief: tr(
          'Applique les corrections — sûres par défaut, IA en option',
          'Applies fixes — safe by default, AI optional',
        ),
        usage: 'axaraaudit fix [--write] [--all] [--ai]',
        options: [
          [
            '--write',
            tr('persiste les corrections (sinon : prévisualisation)', 'persists the fixes (otherwise: preview)'),
          ],
          [
            '--all',
            tr(
              'inclut les tokens proches (--min-confidence <0..1>, défaut 0.7)',
              'includes near-match tokens (--min-confidence <0..1>, default 0.7)',
            ),
          ],
          [
            '--ai',
            tr(
              'délègue le reste (RGAA, valeurs sans token) à Claude',
              'delegates the rest (RGAA, tokenless values) to Claude',
            ),
          ],
          ['--model <id>', tr('modèle IA (défaut : claude-opus-4-8)', 'AI model (default: claude-opus-4-8)')],
        ],
        examples: [
          ['axaraaudit fix', tr("prévisualisation, rien n'est modifié", 'preview, nothing is modified')],
          [
            'axaraaudit fix --write',
            tr('applique les remplacements 100 % sûrs', 'applies the 100% safe replacements'),
          ],
          [
            'axaraaudit fix --ai --write',
            tr(
              'corrige aussi alt, labels, titres… via Claude',
              'also fixes alt, labels, headings… via Claude',
            ),
          ],
        ],
        next: ['audit'],
      },
      {
        name: 'init',
        brief: tr('Génère un .auditorrc.json de démarrage', 'Generates a starter .auditorrc.json'),
        usage: 'axaraaudit init [--force]',
        options: [['--force', tr('écrase un fichier existant', 'overwrites an existing file')]],
        next: ['audit'],
      },
    ],
  },
  {
    icon: '🎧',
    title: tr('EXPLORER & RESSENTIR', 'EXPLORE & EXPERIENCE'),
    commands: [
      {
        name: 'voice',
        brief: tr(
          "Simule un lecteur d'écran : entendez vos composants comme un utilisateur aveugle",
          'Simulates a screen reader: hear your components like a blind user',
        ),
        usage: tr('axaraaudit voice [fichier...]', 'axaraaudit voice [file...]'),
        examples: [
          [
            'axaraaudit voice src/Header.tsx',
            tr('annonce le composant, signale les trous', 'announces the component, flags the gaps'),
          ],
        ],
        next: ['fix'],
      },
      {
        name: 'history',
        brief: tr(
          "Rejoue l'audit sur les derniers commits et trace l'évolution du score",
          'Replays the audit over recent commits and charts the score trend',
        ),
        usage: 'axaraaudit history [--limit <n>]',
        options: [['--limit <n>', tr('nombre de commits (défaut 15)', 'number of commits (default 15)')]],
        next: ['blame', 'fix'],
      },
      {
        name: 'blame',
        brief: tr(
          'Attribue chaque dérive à son auteur (git blame)',
          'Attributes each drift to its author (git blame)',
        ),
        usage: 'axaraaudit blame',
        next: ['fix'],
      },
      {
        name: 'roast',
        brief: tr(
          "L'audit commenté par un humoriste — cinglant mais bienveillant (clé IA requise)",
          'The audit narrated by a comedian — scathing but kind (AI key required)',
        ),
        usage: 'axaraaudit roast [--model <id>]',
        next: ['fix'],
      },
      {
        name: 'hello',
        brief: tr(
          'Rencontrez Axa, la mascotte, et la charte graphique du CLI',
          "Meet Axa, the mascot, and the CLI's visual identity",
        ),
        usage: 'axaraaudit hello [--demo]',
        options: [
          ['--demo', tr('rejoue un audit animé — idéal pour un GIF', 'replays an animated audit — great for a GIF')],
        ],
        next: ['audit'],
      },
    ],
  },
  {
    icon: '⚙️',
    title: tr('CONFIGURATION & COMPTE', 'SETTINGS & ACCOUNT'),
    commands: [
      {
        name: 'settings',
        brief: tr(
          'Panneau de réglages : jetons, langue, serveurs MCP — tout au même endroit',
          'Settings panel: tokens, language, MCP servers — all in one place',
        ),
        usage: tr(
          'axaraaudit settings [set <clé> <valeur>] [mcp install|remove <client>]',
          'axaraaudit settings [set <key> <value>] [mcp install|remove <client>]',
        ),
        options: [
          ['--list', tr('état actuel sans panneau interactif (pipes, CI)', 'current state without the interactive panel (pipes, CI)')],
          ['set lang fr|en|auto', tr('langue de l’interface, persistée', 'interface language, persisted')],
          ['set update-check on|off', tr('notification de mise à jour quotidienne', 'daily update notice')],
          ['mcp install|remove <client>', tr('claude-code · claude-desktop · cursor', 'claude-code · claude-desktop · cursor')],
        ],
        examples: [
          ['axaraaudit settings', tr('panneau interactif (↑↓, Entrée, Échap)', 'interactive panel (↑↓, Enter, Esc)')],
          ['axaraaudit settings mcp install claude-code', tr('branche le serveur MCP dans ce projet', 'wires the MCP server into this project')],
          ['axaraaudit settings set lang en', tr('bascule le CLI en anglais', 'switches the CLI to English')],
        ],
        next: ['login', 'audit'],
      },
      {
        name: 'push',
        brief: tr(
          "Envoie un rapport d'audit au dashboard Pro (équipes, tendances)",
          'Sends an audit report to the Pro dashboard (teams, trends)',
        ),
        usage: tr('axaraaudit push [rapport.json] [options]', 'axaraaudit push [report.json] [options]'),
        options: [
          [
            '--dry-run',
            tr('affiche ce qui serait envoyé, sans jeton ni réseau', 'shows what would be sent, no token or network'),
          ],
          [
            '--skip-rgaa',
            tr('audit frais : dérive design uniquement', 'fresh audit: design drift only'),
          ],
          [
            tr('--config <chemin>', '--config <path>'),
            tr('fichier .auditorrc.json explicite', 'explicit .auditorrc.json file'),
          ],
        ],
        examples: [
          ['axaraaudit push', tr('audit frais, puis envoi', 'fresh audit, then upload')],
          [
            'axaraaudit push report.json',
            tr('envoie un rapport JSON existant (artefact CI)', 'sends an existing JSON report (CI artifact)'),
          ],
          ['axaraaudit push --dry-run', tr("prévisualise l'envoi", 'previews the upload')],
        ],
        next: ['login', 'whoami'],
      },
      {
        name: 'login',
        brief: tr(
          'Enregistre un jeton Pro et/ou une clé Anthropic (active fix --ai)',
          'Stores a Pro token and/or an Anthropic key (enables fix --ai)',
        ),
        usage: tr(
          'axaraaudit login [--token <jeton>] [--anthropic-key <clé>]',
          'axaraaudit login [--token <token>] [--anthropic-key <key>]',
        ),
        options: [
          [
            tr('--token <jeton>', '--token <token>'),
            tr('jeton Pro (--remote, --upload, --ci gate cloud)', 'Pro token (--remote, --upload, --ci cloud gate)'),
          ],
          [
            tr('--anthropic-key <clé>', '--anthropic-key <key>'),
            tr('clé API Anthropic pour fix --ai et roast', 'Anthropic API key for fix --ai and roast'),
          ],
        ],
        next: ['fix', 'settings'],
      },
      {
        name: 'logout',
        brief: tr('Supprime le jeton enregistré', 'Removes the stored token'),
        usage: 'axaraaudit logout',
      },
      {
        name: 'whoami',
        brief: tr("Affiche l'identité liée au jeton", 'Shows the identity tied to the token'),
        usage: 'axaraaudit whoami',
      },
      {
        name: 'completion',
        brief: tr(
          'Complétion shell (Tab) pour axaraaudit et axa',
          'Shell (Tab) completion for axaraaudit and axa',
        ),
        usage: 'axaraaudit completion <bash|zsh|pwsh>',
        examples: [
          ['eval "$(axaraaudit completion bash)"', tr('dans ~/.bashrc', 'in ~/.bashrc')],
          [
            'eval "$(axaraaudit completion zsh)"',
            tr('dans ~/.zshrc (après compinit)', 'in ~/.zshrc (after compinit)'),
          ],
          [
            'axaraaudit completion pwsh | Out-String | Invoke-Expression',
            tr('dans $PROFILE', 'in $PROFILE'),
          ],
        ],
      },
      {
        name: 'help',
        brief: tr(
          "Cette aide — ou l'aide détaillée d'une commande",
          "This help — or a command's detailed help",
        ),
        usage: tr('axaraaudit help [commande]', 'axaraaudit help [command]'),
        examples: [
          ['axaraaudit help fix', tr('options et exemples de `fix`', 'options and examples for `fix`')],
        ],
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
  lines.push(`  ${gradient(`${CLI_NAME} v${CLI_VERSION}`, BRAND.violet, BRAND.cyan, level)} ${paintFg(tr('— audit design-system + RGAA 4.1, dès le terminal', '— design-system + RGAA 4.1 audit, right from the terminal'), BRAND.slate, level)}`);
  lines.push('');
  lines.push(`  ${b('USAGE', level)}  ${paintFg(`${CLI_NAME} ${tr('<commande>', '<command>')} [options]`, BRAND.cyan, level)}`);

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
  lines.push(`  ${b(tr('DÉMARRAGE EXPRESS', 'QUICK START'), level)}`);
  lines.push(`    ${paintFg('axaraaudit audit', BRAND.cyan, level)}              ${paintFg(tr('→ votre premier rapport, zéro config', '→ your first report, zero config'), BRAND.slate, level)}`);
  lines.push(`    ${paintFg('axaraaudit fix --write', BRAND.cyan, level)}        ${paintFg(tr('→ applique les corrections sûres', '→ applies the safe fixes'), BRAND.slate, level)}`);
  lines.push('');
  lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${paintFg(tr('Aide détaillée : ', 'Detailed help: '), BRAND.slate, level)}${paintFg(tr('axaraaudit help <commande>', 'axaraaudit help <command>'), BRAND.cyan, level)}${paintFg(tr('  ·  codes de sortie : 0 ok, 1 gate échoué, 2 erreur d\'usage', '  ·  exit codes: 0 ok, 1 gate failed, 2 usage error'), BRAND.slate, level)}`);
  lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${paintFg(tr('Langue : ', 'Language: '), BRAND.slate, level)}${paintFg('--lang fr|en', BRAND.cyan, level)}${paintFg(tr('  ou  AXARA_LANG=fr|en  (défaut : locale système)', '  or  AXARA_LANG=fr|en  (default: system locale)'), BRAND.slate, level)}`);
  lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${paintFg(tr('Réglages : ', 'Settings: '), BRAND.slate, level)}${paintFg('axaraaudit settings', BRAND.cyan, level)}${paintFg(tr('  →  jetons, langue, serveurs MCP — panneau interactif', '  →  tokens, language, MCP servers — interactive panel'), BRAND.slate, level)}`);
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
    lines.push(`  ${b(tr('EXEMPLES', 'EXAMPLES'), level)}`);
    const width = Math.max(...spec.examples.map(([cmd]) => cmd.length));
    for (const [cmd, doc] of spec.examples) {
      lines.push(`    ${paintFg('$', BRAND.pink, level)} ${paintFg(cmd.padEnd(width), BRAND.cyan, level)}  ${paintFg(doc, BRAND.slate, level)}`);
    }
  }

  if (spec.next !== undefined && spec.next.length > 0) {
    const chain = spec.next.map((n) => paintFg(`axaraaudit ${n}`, BRAND.cyan, level)).join(paintFg('  ·  ', BRAND.slate, level));
    lines.push('');
    lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${paintFg(tr('Suite logique :', 'Next up:'), BRAND.slate, level)} ${chain}`);
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
        `${tr('Commande inconnue :', 'Unknown command:')} ${target}${suggestion !== undefined ? tr(` — vouliez-vous dire \`${suggestion}\` ?`, ` — did you mean \`${suggestion}\`?`) : ''}\n`,
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
