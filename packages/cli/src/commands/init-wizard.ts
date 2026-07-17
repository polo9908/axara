/**
 * `axaraaudit init` interactif — l'onboarding guidé du design system.
 *
 * Philosophie : ne jamais demander ce qu'on peut détecter. Le wizard scanne
 * d'abord le projet (fichiers DTCG conventionnels, custom properties CSS),
 * puis pose UNE question aux choix adaptés, aide en cas d'erreur, et offre
 * toujours une porte de sortie : sans design system, l'audit RGAA +
 * tabulation reste entièrement fonctionnel (`"tokens": false`).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import {
  extractCssVarTokens,
  parseDtcgString,
  tailwindThemeToDtcg,
  type CssSource,
  type CssVarExtraction,
} from '@axaraaudit/core';
import { collectFiles } from '../scan/walk.js';
import { DEFAULT_RC, RC_FILENAME } from '../config/rc.js';
import { resolveFigmaToken, saveFigmaToken, FIGMA_TOKEN_ENV_VAR } from '../config/credentials.js';
import { tr } from '../i18n.js';
import { dim, green, red, yellow } from '../report/render.js';
import { importFigmaTokens, parseFigmaRef } from '../services/figma-import.js';
import { detectTailwindConfig, loadTailwindTheme, type TailwindLoad } from '../services/tailwind.js';
import { confirmYesNo, canConfirm } from '../ui/confirm.js';
import { askText } from '../ui/input.js';
import { selectOption, type SelectChoice } from '../ui/select.js';
import { createSpinner } from '../ui/spinner.js';

const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
/** Mêmes noms conventionnels que le serveur MCP (tokens-source.ts). */
const CONVENTIONAL_NAMES = [
  'design-tokens.dtcg.json',
  'tokens.dtcg.json',
  'design-tokens.json',
  'tokens.json',
];
const GENERATED_TOKENS_FILE = 'design-tokens.dtcg.json';

/** Contenu de `.auditorrc.json` — partagé avec le chemin scripté d'init.ts. */
export const rcTemplate = (project: string, tokens: string | false): string =>
  `${JSON.stringify(
    {
      project,
      tokens,
      include: ['src', 'components', 'styles'],
      exclude: ['node_modules', 'dist', 'build', '.next'],
      extensions: ['.css', '.scss', '.tsx', '.jsx', '.html'],
      remBasePx: 16,
      rgaa: {
        enabled: true,
        scope: 'component',
        contrast: false,
        priority: ['1.1', '3.2', '11.1'],
      },
      ci: {
        failUnder: 80,
        blockOnCritical: true,
      },
      pro: {
        apiUrl: 'https://api.axara.dev',
        upload: false,
        remoteConfig: false,
      },
    },
    null,
    2,
  )}\n`;

export interface Detection {
  /** Fichiers DTCG valides trouvés à la racine (relatifs, `./`-préfixés). */
  readonly dtcgCandidates: readonly string[];
  readonly extraction: CssVarExtraction;
  /** Config Tailwind à la racine (chemin absolu), ou null. */
  readonly tailwindConfig: string | null;
}

export function detectDesignSystem(cwd: string): Detection {
  const seen = new Set<string>();
  const dtcgCandidates: string[] = [];
  let rootEntries: string[] = [];
  try {
    rootEntries = readdirSync(cwd);
  } catch {
    // Racine illisible : la détection reste vide, le wizard propose le reste.
  }
  const names = [
    ...CONVENTIONAL_NAMES,
    ...rootEntries.filter((name) => name.endsWith('.dtcg.json')),
  ];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const abs = resolve(cwd, name);
    if (!existsSync(abs)) continue;
    try {
      const parsed = parseDtcgString(readFileSync(abs, 'utf8').replace(/^﻿/, ''));
      if (parsed.tokens.length > 0) dtcgCandidates.push(`./${name}`);
    } catch {
      // Fichier illisible ou JSON cassé : on ne le propose pas.
    }
  }

  const cssPaths = collectFiles(cwd, DEFAULT_RC.include, DEFAULT_RC.exclude, DEFAULT_RC.extensions)
    .filter((path) => CSS_EXT.has(extname(path).toLowerCase()));
  const cssSources: CssSource[] = cssPaths.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));
  const extraction = extractCssVarTokens(cssSources, { remBasePx: DEFAULT_RC.remBasePx });

  return { dtcgCandidates, extraction, tailwindConfig: detectTailwindConfig(cwd) };
}

/**
 * Écrit `design-tokens.dtcg.json` depuis un document en mémoire.
 * Retourne le chemin rc (`./…`) ou null si un fichier existant bloque.
 */
function writeTokensFile(
  cwd: string,
  document: Record<string, unknown>,
  force: boolean,
): string | null {
  const target = resolve(cwd, GENERATED_TOKENS_FILE);
  if (existsSync(target) && !force) {
    process.stdout.write(
      yellow(
        tr(
          `  ⚠ ${GENERATED_TOKENS_FILE} existe déjà — relancez avec --force pour l'écraser.\n`,
          `  ⚠ ${GENERATED_TOKENS_FILE} already exists — rerun with --force to overwrite it.\n`,
        ),
      ),
    );
    return null;
  }
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return `./${GENERATED_TOKENS_FILE}`;
}

/** Message bilingue pour un échec de chargement Tailwind. */
function tailwindFailureMessage(load: Extract<TailwindLoad, { ok: false }>): string {
  switch (load.reason) {
    case 'ts-config':
      return tr(
        `${load.file} est en TypeScript — non importable sans loader. Deux voies : déclarez vos tokens en CSS (@theme, Tailwind v4 — l'extraction les trouve déjà) ou convertissez le config en .js.`,
        `${load.file} is TypeScript — not importable without a loader. Two routes: declare your tokens in CSS (@theme, Tailwind v4 — extraction already finds them) or convert the config to .js.`,
      );
    case 'no-theme':
      return tr(
        `${load.file} ne contient pas de section "theme" exploitable.`,
        `${load.file} has no usable "theme" section.`,
      );
    case 'import-failed':
      return tr(
        `Import de ${load.file} impossible : ${load.detail ?? ''}`,
        `Could not import ${load.file}: ${load.detail ?? ''}`,
      );
  }
}

/** Valide un fichier DTCG fourni par l'utilisateur ; message d'erreur ou null. */
export function validateDtcgFile(
  abs: string,
): { ok: true; count: number } | { ok: false; why: string } {
  if (!existsSync(abs)) {
    return { ok: false, why: tr(`fichier introuvable : ${abs}`, `file not found: ${abs}`) };
  }
  let parsed: ReturnType<typeof parseDtcgString>;
  try {
    parsed = parseDtcgString(readFileSync(abs, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, why: tr(`lecture impossible : ${reason}`, `cannot read: ${reason}`) };
  }
  if (parsed.tokens.length === 0) {
    const firstError = parsed.errors[0];
    return {
      ok: false,
      why:
        firstError !== undefined
          ? tr(`JSON/DTCG invalide : ${firstError}`, `invalid JSON/DTCG: ${firstError}`)
          : tr(
              'aucun token exploitable (attendu : document DTCG avec $type/$value)',
              'no usable token (expected: DTCG document with $type/$value)',
            ),
    };
  }
  return { ok: true, count: parsed.tokens.length };
}

/** Demande un chemin de fichier tokens (3 essais) ; null = retour au menu. */
async function askTokensPath(cwd: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await askText(
      tr(
        'Chemin de votre fichier de tokens (Entrée pour revenir) :',
        'Path to your tokens file (Enter to go back):',
      ),
    );
    if (answer === null) return null;
    const abs = isAbsolute(answer) ? answer : resolve(cwd, answer);
    const verdict = validateDtcgFile(abs);
    if (verdict.ok) {
      process.stdout.write(
        green(
          `  ✓ ${tr(
            `${verdict.count} token(s) chargé(s) depuis ${answer}`,
            `${verdict.count} token(s) loaded from ${answer}`,
          )}\n`,
        ),
      );
      const rel = relative(cwd, abs);
      // Chemin portable dans le rc : relatif si possible, séparateurs POSIX.
      return rel.startsWith('..') ? abs : `./${rel.replaceAll('\\', '/')}`;
    }
    process.stdout.write(red(`  ✖ ${verdict.why}\n`));
    process.stdout.write(
      dim(
        `    ${tr(
          'Attendu : JSON au format DTCG — ex. { "color": { "primary": { "$type": "color", "$value": "#1A3C6E" } } }',
          'Expected: DTCG-format JSON — e.g. { "color": { "primary": { "$type": "color", "$value": "#1A3C6E" } } }',
        )}\n`,
      ),
    );
  }
  return null;
}

/** Écrit (ou met à jour) `.auditorrc.json` ; false = annulé par l'utilisateur. */
async function writeRc(cwd: string, tokens: string | false, force: boolean): Promise<boolean> {
  const target = resolve(cwd, RC_FILENAME);
  if (existsSync(target) && !force) {
    const pick = await selectOption(
      tr(`${RC_FILENAME} existe déjà :`, `${RC_FILENAME} already exists:`),
      [
        {
          value: 'update',
          label: tr('Mettre à jour "tokens" uniquement', 'Update "tokens" only'),
          detail: tr('le reste de la configuration est conservé', 'the rest of the config is kept'),
        },
        { value: 'cancel', label: tr('Annuler', 'Cancel') },
      ],
    );
    if (pick !== 'update') return false;
    try {
      const raw = JSON.parse(readFileSync(target, 'utf8').replace(/^﻿/, '')) as Record<
        string,
        unknown
      >;
      raw['tokens'] = tokens;
      writeFileSync(target, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
      return true;
    } catch {
      process.stdout.write(
        red(
          tr(
            `  ✖ ${RC_FILENAME} illisible — relancez avec --force pour le régénérer.\n`,
            `  ✖ ${RC_FILENAME} unreadable — rerun with --force to regenerate it.\n`,
          ),
        ),
      );
      return false;
    }
  }
  writeFileSync(target, rcTemplate(basename(cwd), tokens), 'utf8');
  return true;
}

function printTokensCreated(count: number): void {
  process.stdout.write(
    green(
      `  ✓ ${tr(
        `${GENERATED_TOKENS_FILE} créé (${count} token(s)).`,
        `${GENERATED_TOKENS_FILE} created (${count} token(s)).`,
      )}\n`,
    ),
  );
  process.stdout.write(
    dim(
      `    ${tr(
        'Ce fichier est à vous : éditez-le, enrichissez-le, versionnez-le.',
        'This file is yours: edit it, enrich it, commit it.',
      )}\n`,
    ),
  );
}

function printWarnings(warnings: readonly string[]): void {
  for (const warning of warnings.slice(0, 5)) {
    process.stdout.write(dim(`    · ${warning}\n`));
  }
  if (warnings.length > 5) {
    process.stdout.write(
      dim(
        `    · ${tr(`… et ${warnings.length - 5} autre(s)`, `… and ${warnings.length - 5} more`)}\n`,
      ),
    );
  }
}

/** Branche Tailwind : charge, convertit, écrit — null = retour au menu. */
async function importFromTailwind(
  cwd: string,
  configPath: string,
  force: boolean,
): Promise<string | null> {
  const spinner = createSpinner(
    tr(`Lecture de ${basename(configPath)}…`, `Reading ${basename(configPath)}…`),
  );
  spinner.start();
  const load = await loadTailwindTheme(configPath);
  if (!load.ok) {
    spinner.fail(tr('Import Tailwind impossible', 'Tailwind import failed'));
    process.stdout.write(red(`  ✖ ${tailwindFailureMessage(load)}\n`));
    return null;
  }
  const conversion = tailwindThemeToDtcg(load.theme);
  if (conversion.count === 0) {
    spinner.fail(tr('Import Tailwind impossible', 'Tailwind import failed'));
    process.stdout.write(
      red(
        `  ✖ ${tr(
          'Aucun token exploitable dans le thème (couleurs, spacing, radius…).',
          'No usable token in the theme (colors, spacing, radius…).',
        )}\n`,
      ),
    );
    return null;
  }
  spinner.succeed(
    tr(
      `${conversion.count} token(s) lus depuis ${basename(configPath)}`,
      `${conversion.count} token(s) read from ${basename(configPath)}`,
    ),
  );
  const written = writeTokensFile(cwd, conversion.document, force);
  if (written === null) return null;
  printTokensCreated(conversion.count);
  printWarnings(conversion.warnings);
  return written;
}

/** Branche Figma interactive : jeton, clé de fichier, import — null = menu. */
async function importFromFigmaInteractive(cwd: string, force: boolean): Promise<string | null> {
  let token = resolveFigmaToken();
  let tokenIsNew = false;
  if (token === null) {
    process.stdout.write(
      dim(
        `    ${tr(
          `Jeton personnel Figma requis (figma.com → Settings → Personal access tokens) — saisie visible, ou variable ${FIGMA_TOKEN_ENV_VAR}.`,
          `Figma personal access token required (figma.com → Settings → Personal access tokens) — input is visible, or set ${FIGMA_TOKEN_ENV_VAR}.`,
        )}\n`,
      ),
    );
    token = await askText(tr('Jeton Figma (Entrée pour revenir) :', 'Figma token (Enter to go back):'));
    if (token === null) return null;
    tokenIsNew = true;
  }
  const ref = await askText(
    tr('URL ou clé du fichier Figma :', 'Figma file URL or key:'),
  );
  if (ref === null) return null;
  const fileKey = parseFigmaRef(ref);
  if (fileKey === null) {
    process.stdout.write(
      red(
        `  ✖ ${tr(
          'Référence invalide — attendu : une URL figma.com/design/… ou la clé du fichier.',
          'Invalid reference — expected: a figma.com/design/… URL or the file key.',
        )}\n`,
      ),
    );
    return null;
  }

  const spinner = createSpinner(tr('Import des variables Figma…', 'Importing Figma variables…'));
  spinner.start();
  const result = await importFigmaTokens({ fileKey, token });
  if (!result.ok) {
    spinner.fail(tr('Import Figma impossible', 'Figma import failed'));
    process.stdout.write(red(`  ✖ ${result.message}\n`));
    return null;
  }
  spinner.succeed(
    tr(`${result.count} variable(s) Figma importée(s)`, `${result.count} Figma variable(s) imported`),
  );
  const written = writeTokensFile(cwd, result.document, force);
  if (written === null) return null;
  printTokensCreated(result.count);
  printWarnings(result.warnings);

  if (tokenIsNew && canConfirm()) {
    const save = await confirmYesNo(
      tr('Mémoriser ce jeton Figma pour la prochaine fois ?', 'Remember this Figma token for next time?'),
    );
    if (save) saveFigmaToken(token);
  }
  return written;
}

/** `init --from-tailwind` non interactif : import + rc, exit code CLI. */
export async function runFromTailwind(options: {
  readonly cwd: string;
  readonly configPath?: string | undefined;
  readonly force: boolean;
}): Promise<number> {
  const configPath =
    options.configPath !== undefined && options.configPath !== ''
      ? resolve(options.cwd, options.configPath)
      : detectTailwindConfig(options.cwd);
  if (configPath === null || !existsSync(configPath)) {
    process.stderr.write(
      red(
        tr(
          'Aucun config Tailwind trouvé (tailwind.config.{js,mjs,cjs,ts}).\n',
          'No Tailwind config found (tailwind.config.{js,mjs,cjs,ts}).\n',
        ),
      ),
    );
    return 2;
  }
  const load = await loadTailwindTheme(configPath);
  if (!load.ok) {
    process.stderr.write(red(`✖ ${tailwindFailureMessage(load)}\n`));
    return 1;
  }
  const conversion = tailwindThemeToDtcg(load.theme);
  if (conversion.count === 0) {
    process.stderr.write(
      red(tr('Aucun token exploitable dans le thème.\n', 'No usable token in the theme.\n')),
    );
    return 1;
  }
  const written = writeTokensFile(options.cwd, conversion.document, options.force);
  if (written === null) return 2;
  printTokensCreated(conversion.count);
  printWarnings(conversion.warnings);
  return finalizeRcNonInteractive(options.cwd, written, options.force);
}

/** `init --from-figma <urlOuClé>` non interactif : jeton via env/credentials. */
export async function runFromFigma(options: {
  readonly cwd: string;
  readonly ref: string;
  readonly force: boolean;
}): Promise<number> {
  const fileKey = parseFigmaRef(options.ref);
  if (fileKey === null) {
    process.stderr.write(
      red(
        tr(
          'Référence Figma invalide — attendu : URL figma.com/design/… ou clé de fichier.\n',
          'Invalid Figma reference — expected: figma.com/design/… URL or file key.\n',
        ),
      ),
    );
    return 2;
  }
  const token = resolveFigmaToken();
  if (token === null) {
    process.stderr.write(
      red(
        tr(
          `Jeton Figma requis : définissez ${FIGMA_TOKEN_ENV_VAR} ou enregistrez-le via \`axaraaudit settings\`.\n`,
          `Figma token required: set ${FIGMA_TOKEN_ENV_VAR} or store it via \`axaraaudit settings\`.\n`,
        ),
      ),
    );
    return 2;
  }
  const result = await importFigmaTokens({ fileKey, token });
  if (!result.ok) {
    process.stderr.write(red(`✖ ${result.message}\n`));
    return 1;
  }
  const written = writeTokensFile(options.cwd, result.document, options.force);
  if (written === null) return 2;
  printTokensCreated(result.count);
  printWarnings(result.warnings);
  return finalizeRcNonInteractive(options.cwd, written, options.force);
}

/** Écrit/patche le rc sans interaction (chemins --from-*). */
function finalizeRcNonInteractive(cwd: string, tokens: string, force: boolean): number {
  const target = resolve(cwd, RC_FILENAME);
  if (existsSync(target) && !force) {
    // Rc existant : on ne touche qu'au champ tokens, le reste est conservé.
    try {
      const raw = JSON.parse(readFileSync(target, 'utf8').replace(/^﻿/, '')) as Record<
        string,
        unknown
      >;
      raw['tokens'] = tokens;
      writeFileSync(target, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    } catch {
      process.stderr.write(
        red(
          tr(
            `${RC_FILENAME} illisible — relancez avec --force pour le régénérer.\n`,
            `${RC_FILENAME} unreadable — rerun with --force to regenerate it.\n`,
          ),
        ),
      );
      return 2;
    }
  } else {
    writeFileSync(target, rcTemplate(basename(cwd), tokens), 'utf8');
  }
  process.stdout.write(green(tr(`✓ ${RC_FILENAME} écrit.\n`, `✓ ${RC_FILENAME} written.\n`)));
  process.stdout.write(
    dim(tr(`  Design system : ${tokens}\n`, `  Design system: ${tokens}\n`)),
  );
  return 0;
}

export async function runInitWizard(options: {
  readonly cwd: string;
  readonly force: boolean;
}): Promise<number> {
  const { cwd, force } = options;

  const spinner = createSpinner(
    tr('Détection de votre design system…', 'Detecting your design system…'),
  );
  spinner.start();
  const detection = detectDesignSystem(cwd);
  const varCount = detection.extraction.count;
  const detected = detection.dtcgCandidates[0];
  spinner.succeed(
    detected !== undefined
      ? tr(`Fichier de tokens détecté : ${detected}`, `Tokens file detected: ${detected}`)
      : varCount > 0
        ? tr(
            `${varCount} variable(s) CSS détectée(s), aucun fichier de tokens`,
            `${varCount} CSS variable(s) detected, no tokens file`,
          )
        : tr('Aucun design system détecté', 'No design system detected'),
  );

  // — UNE question, aux choix adaptés à ce qui a été détecté —
  const choices: SelectChoice[] = [];
  if (detected !== undefined) {
    choices.push({
      value: 'use-detected',
      label: tr(`Utiliser ${detected}`, `Use ${detected}`),
      detail: tr('recommandé — détecté dans votre projet', 'recommended — detected in your project'),
    });
  }
  if (detection.tailwindConfig !== null) {
    choices.push({
      value: 'import-tailwind',
      label: tr('Importer depuis Tailwind', 'Import from Tailwind'),
      detail: `${basename(detection.tailwindConfig)} → ${GENERATED_TOKENS_FILE}`,
    });
  }
  if (varCount >= 3) {
    choices.push({
      value: 'generate',
      label: tr('Générer depuis mon CSS', 'Generate from my CSS'),
      detail: tr(
        `${varCount} variable(s) → ${GENERATED_TOKENS_FILE}, à vous ensuite`,
        `${varCount} variable(s) → ${GENERATED_TOKENS_FILE}, then it's yours`,
      ),
    });
  }
  choices.push({
    value: 'import-figma',
    label: tr('Importer depuis Figma', 'Import from Figma'),
    detail: tr('variables Figma → DTCG (jeton requis)', 'Figma variables → DTCG (token required)'),
  });
  choices.push({
    value: 'own-path',
    label: tr("J'ai déjà un fichier de tokens", 'I already have a tokens file'),
    detail: tr('indiquez son chemin, je le valide', "point me at it, I'll validate it"),
  });
  choices.push({
    value: 'none',
    label: tr('Pas de design system pour l’instant', 'No design system for now'),
    detail: tr('audit RGAA + tabulation quand même', 'RGAA + keyboard audit anyway'),
  });

  let tokens: string | false | undefined;
  for (;;) {
    const pick = await selectOption(tr('Votre design system :', 'Your design system:'), choices);
    if (pick === null) {
      process.stdout.write(
        dim(tr('  Configuration annulée — rien n’a été écrit.\n', '  Setup cancelled — nothing was written.\n')),
      );
      return 0;
    }
    if (pick === 'use-detected' && detected !== undefined) {
      tokens = detected;
      break;
    }
    if (pick === 'own-path') {
      const path = await askTokensPath(cwd);
      if (path === null) continue; // retour au menu
      tokens = path;
      break;
    }
    if (pick === 'generate') {
      const written = writeTokensFile(cwd, detection.extraction.document, force);
      if (written === null) continue;
      printTokensCreated(varCount);
      tokens = written;
      break;
    }
    if (pick === 'import-tailwind' && detection.tailwindConfig !== null) {
      const result = await importFromTailwind(cwd, detection.tailwindConfig, force);
      if (result === null) continue; // échec expliqué → retour au menu
      tokens = result;
      break;
    }
    if (pick === 'import-figma') {
      const result = await importFromFigmaInteractive(cwd, force);
      if (result === null) continue;
      tokens = result;
      break;
    }
    if (pick === 'none') {
      tokens = false;
      break;
    }
  }

  const written = await writeRc(cwd, tokens, force);
  if (!written) {
    process.stdout.write(
      dim(tr('  Configuration annulée — rien n’a été écrit.\n', '  Setup cancelled — nothing was written.\n')),
    );
    return 0;
  }
  process.stdout.write(green(tr(`  ✓ ${RC_FILENAME} écrit.\n`, `  ✓ ${RC_FILENAME} written.\n`)));
  process.stdout.write(
    dim(
      tokens === false
        ? `    ${tr(
            'Mode RGAA + tabulation — relancez `axaraaudit init` le jour où vous aurez un design system.',
            'RGAA + keyboard mode — rerun `axaraaudit init` the day you have a design system.',
          )}\n`
        : `    ${tr(`Design system : ${tokens}`, `Design system: ${tokens}`)}\n`,
    ),
  );

  if (canConfirm()) {
    const runNow = await confirmYesNo(
      tr('Lancer le premier audit maintenant ?', 'Run the first audit now?'),
    );
    if (runNow) {
      process.stdout.write('\n');
      const { runAudit } = await import('./audit.js');
      return runAudit([]);
    }
  }
  return 0;
}
