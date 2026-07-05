/**
 * `axaraaudit history` — replay the design-drift audit across the git history
 * and chart the score over time (sparkline + per-commit table).
 *
 * `axaraaudit blame` — attribute each current drift to the commit/author that
 * introduced it, via `git blame`.
 *
 * Both read file contents straight from the object database (`git show`),
 * so nothing is checked out and the working tree is never touched.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import {
  auditSources,
  extractCssVarTokens,
  type CssSource,
  type DriftIssue,
  type SourceFile,
} from '@axaraaudit/core';
import { ConfigError, loadRc, type LoadedRc } from '../config/rc.js';
import { loadTokensSource } from '../config/tokens-source.js';
import { collectFiles } from '../scan/walk.js';
import { computeScore } from '../report/score.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';

const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const SPARK = '▁▂▃▄▅▆▇█';

function git(args: readonly string[], cwd: string): string {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Commande git en échec (${args[0]}) : ${reason.split('\n')[0]}`);
  }
}

function ensureGitRepo(cwd: string): void {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe' });
  } catch {
    throw new ConfigError('Ce dossier n’est pas un dépôt git — `history` et `blame` ont besoin de l’historique.');
  }
}

function sparkline(scores: readonly (number | null)[]): string {
  return scores
    .map((score) => {
      if (score === null) return dim('·');
      const idx = Math.min(SPARK.length - 1, Math.floor((score / 100) * SPARK.length));
      const ch = SPARK[idx]!;
      return score >= 80 ? green(ch) : score >= 60 ? yellow(ch) : red(ch);
    })
    .join('');
}

interface CommitInfo {
  readonly sha: string;
  readonly short: string;
  readonly date: string;
  readonly subject: string;
}

/** Score one commit by auditing its files as stored in git (no checkout). */
function scoreCommit(commit: CommitInfo, loaded: LoadedRc): number | null {
  const listed = git(['ls-tree', '-r', '--name-only', commit.sha], loaded.rootDir)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const excluded = new Set([...loaded.rc.exclude, 'node_modules', '.git']);
  const extensions = new Set(loaded.rc.extensions.map((e) => e.toLowerCase()));
  const paths = listed.filter((path) => {
    if (path.split('/').some((segment) => excluded.has(segment))) return false;
    return extensions.has(extname(path).toLowerCase());
  });
  if (paths.length === 0) return null;

  const files: SourceFile[] = paths.map((path) => ({
    path,
    content: git(['show', `${commit.sha}:${path}`], loaded.rootDir),
  }));

  // Tokens at that point in time: the DTCG file if it existed, else zero-config.
  const tokensRel = loaded.rc.tokens.replace(/^\.\//, '').replaceAll('\\', '/');
  let tokensJson: string | null = null;
  if (listed.includes(tokensRel)) {
    tokensJson = git(['show', `${commit.sha}:${tokensRel}`], loaded.rootDir);
  } else {
    const cssSources: CssSource[] = files.filter((f) => CSS_EXT.has(extname(f.path).toLowerCase()));
    const extraction = extractCssVarTokens(cssSources, { remBasePx: loaded.rc.remBasePx });
    if (extraction.count >= 3) tokensJson = JSON.stringify(extraction.document);
  }
  if (tokensJson === null) return null;

  const drift = auditSources(tokensJson, files, { remBasePx: loaded.rc.remBasePx });
  return computeScore(drift.summary, []);
}

export async function runHistory(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      limit: { type: 'string' },
    },
    allowPositionals: true,
  });
  const limit = values.limit === undefined ? 15 : Number(values.limit);
  if (Number.isNaN(limit) || limit < 2 || limit > 200) {
    throw new ConfigError(`--limit doit être un nombre entre 2 et 200 (reçu: ${values.limit}).`);
  }

  const cwd = process.cwd();
  ensureGitRepo(cwd);
  const loaded = loadRc(cwd, values.config);

  const log = git(['log', `--format=%H\t%h\t%cs\t%s`, '-n', String(limit)], cwd);
  const commits: CommitInfo[] = log
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [sha = '', short = '', date = '', ...rest] = line.split('\t');
      return { sha, short, date, subject: rest.join('\t') };
    })
    .reverse(); // oldest → newest

  if (commits.length < 2) {
    throw new ConfigError('Pas assez de commits pour tracer une évolution (minimum 2).');
  }

  process.stdout.write(`\n${bold('  📈 MACHINE À REMONTER LA DETTE')} ${dim(`(${commits.length} commits, score design)`)}\n\n`);

  const scores: (number | null)[] = [];
  for (const commit of commits) {
    let score: number | null;
    try {
      score = scoreCommit(commit, loaded);
    } catch {
      score = null;
    }
    scores.push(score);
    const bar = score === null ? dim('—') : score >= 80 ? green(String(score)) : score >= 60 ? yellow(String(score)) : red(String(score));
    process.stdout.write(
      `  ${dim(commit.date)}  ${cyan(commit.short)}  ${bar.padEnd(3)}  ${dim(commit.subject.slice(0, 60))}\n`,
    );
  }

  const numeric = scores.filter((s): s is number => s !== null);
  const first = numeric[0];
  const last = numeric[numeric.length - 1];
  process.stdout.write(`\n  SCORE  ${first ?? '—'} ${sparkline(scores)} ${last ?? '—'}`);
  if (first !== undefined && last !== undefined && first !== last) {
    const delta = last - first;
    process.stdout.write(delta > 0 ? green(`   (+${delta} 🎉)`) : red(`   (${delta} 📉)`));
  }
  process.stdout.write('\n\n');
  return 0;
}

// ─────────────────────────── blame ───────────────────────────

interface BlameInfo {
  readonly author: string;
  readonly date: string;
  readonly short: string;
}

function blameLine(path: string, line: number, cwd: string): BlameInfo {
  try {
    const raw = execFileSync(
      'git',
      ['blame', '-L', `${line},${line}`, '--porcelain', '--', path],
      { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const sha = raw.split('\n')[0]?.split(' ')[0] ?? '';
    const author = /^author (.+)$/m.exec(raw)?.[1] ?? 'inconnu';
    const time = /^author-time (\d+)$/m.exec(raw)?.[1];
    const date = time !== undefined ? new Date(Number(time) * 1000).toISOString().slice(0, 10) : '';
    if (sha.startsWith('0000000')) return { author: '(non committé)', date: '', short: '' };
    return { author, date, short: sha.slice(0, 7) };
  } catch {
    return { author: '(non committé)', date: '', short: '' };
  }
}

export async function runBlame(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { config: { type: 'string' }, tokens: { type: 'string' } },
    allowPositionals: true,
  });

  const cwd = process.cwd();
  ensureGitRepo(cwd);
  const loaded = loadRc(cwd, values.config);

  const filePaths = collectFiles(loaded.rootDir, loaded.rc.include, loaded.rc.exclude, loaded.rc.extensions);
  const files: SourceFile[] = filePaths.map((path) => ({ path, content: readFileSync(path, 'utf8') }));
  const tokensSource = loadTokensSource(loaded, values.tokens, files);
  const report = auditSources(tokensSource.json, files, { remBasePx: loaded.rc.remBasePx });

  if (report.issues.length === 0) {
    process.stdout.write(green('\n  ✓ Aucune dérive — personne à blâmer aujourd’hui.\n\n'));
    return 0;
  }

  const byAuthor = new Map<string, { issue: DriftIssue; info: BlameInfo }[]>();
  for (const issue of report.issues) {
    const info = blameLine(relative(loaded.rootDir, issue.file).split(sep).join('/'), issue.line, loaded.rootDir);
    const list = byAuthor.get(info.author) ?? [];
    list.push({ issue, info });
    byAuthor.set(info.author, list);
  }

  const ranking = [...byAuthor.entries()].sort((a, b) => b[1].length - a[1].length);

  process.stdout.write(`\n${bold('  🕵️ BLAME — qui a introduit les dérives ?')}\n\n`);
  ranking.forEach(([author, entries], rank) => {
    const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '  ';
    process.stdout.write(`  ${medal} ${bold(author)} — ${entries.length} dérive(s)\n`);
    for (const { issue, info } of entries.slice(0, 5)) {
      const where = `${relative(loaded.rootDir, issue.file)}:L${issue.line}`;
      const commit = info.short !== '' ? dim(` (${info.short}, ${info.date})`) : '';
      process.stdout.write(`     ${yellow('≈')} ${dim(where)}  ${issue.property}: ${issue.value}${commit}\n`);
    }
    if (entries.length > 5) process.stdout.write(dim(`     … et ${entries.length - 5} autre(s)\n`));
  });
  process.stdout.write(dim('\n  Sans rancune — `axaraaudit fix --all --write` efface l’ardoise.\n\n'));
  return 0;
}
