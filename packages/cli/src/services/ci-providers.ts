/**
 * Fournisseurs CI pour le commentaire de PR/MR — GitHub Actions en priorité,
 * GitLab CI ensuite. Zéro dépendance : fetch natif + variables d'environnement
 * standard des runners. Le commentaire est « sticky » : marqué par un
 * commentaire HTML invisible, il est mis à jour à chaque run au lieu
 * d'empiler un commentaire par push.
 * CI providers for the PR/MR comment — GitHub Actions first, GitLab CI next.
 * Zero dependency: native fetch + standard runner environment variables. The
 * comment is sticky: tagged with an invisible HTML marker, it is updated on
 * every run instead of stacking one comment per push.
 */

import { readFileSync } from 'node:fs';
import { USER_AGENT } from '../version.js';

/** Marqueur d'identification du commentaire sticky. Ne jamais le changer. */
export const COMMENT_MARKER = '<!-- axaraaudit:pr-comment -->';

const TIMEOUT_MS = 10_000;

export type CiEnv = Readonly<Record<string, string | undefined>>;

export interface GithubPrContext {
  readonly provider: 'github';
  readonly apiUrl: string;
  /** `owner/repo`. */
  readonly repo: string;
  readonly prNumber: number;
  readonly token: string;
}

export interface GitlabMrContext {
  readonly provider: 'gitlab';
  readonly apiUrl: string;
  readonly projectId: string;
  readonly mrIid: string;
  readonly token: string;
}

export type PrContext = GithubPrContext | GitlabMrContext;

/** Numéro de PR : `refs/pull/123/merge`, sinon l'événement webhook sur disque. */
function githubPrNumber(env: CiEnv): number | null {
  const refMatch = /^refs\/pull\/(\d+)\//.exec(env['GITHUB_REF'] ?? '');
  if (refMatch !== null) return Number(refMatch[1]);
  const eventPath = env['GITHUB_EVENT_PATH'];
  if (eventPath !== undefined) {
    try {
      const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
        pull_request?: { number?: number };
      };
      if (typeof event.pull_request?.number === 'number') return event.pull_request.number;
    } catch {
      // Événement illisible : pas de contexte PR.
    }
  }
  return null;
}

/**
 * Détecte le contexte PR/MR depuis l'environnement du runner, ou null hors CI
 * (ou hors pipeline de PR). GitHub : GITHUB_TOKEN (celui du workflow suffit,
 * avec `permissions: pull-requests: write`). GitLab : GITLAB_TOKEN ou
 * AXARA_GITLAB_TOKEN (PAT scope `api` — le CI_JOB_TOKEN ne peut pas poster de
 * note).
 */
export function detectPrContext(env: CiEnv = process.env): PrContext | null {
  if (env['GITHUB_ACTIONS'] === 'true') {
    const repo = env['GITHUB_REPOSITORY'];
    const token = env['GITHUB_TOKEN'];
    const prNumber = githubPrNumber(env);
    if (repo !== undefined && token !== undefined && token !== '' && prNumber !== null) {
      return {
        provider: 'github',
        apiUrl: env['GITHUB_API_URL'] ?? 'https://api.github.com',
        repo,
        prNumber,
        token,
      };
    }
    return null;
  }
  if (env['GITLAB_CI'] === 'true') {
    const apiUrl = env['CI_API_V4_URL'];
    const projectId = env['CI_PROJECT_ID'];
    const mrIid = env['CI_MERGE_REQUEST_IID'];
    const token = env['AXARA_GITLAB_TOKEN'] ?? env['GITLAB_TOKEN'];
    if (
      apiUrl !== undefined &&
      projectId !== undefined &&
      mrIid !== undefined &&
      token !== undefined &&
      token !== ''
    ) {
      return { provider: 'gitlab', apiUrl, projectId, mrIid, token };
    }
    return null;
  }
  return null;
}

export class CiApiError extends Error {}

async function apiRequest(
  url: string,
  headers: Record<string, string>,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CiApiError(`${url}: ${reason}`);
  }
  if (!response.ok) {
    throw new CiApiError(`HTTP ${response.status} — ${init.method ?? 'GET'} ${url}`);
  }
  const text = await response.text();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new CiApiError(`${url}: réponse non-JSON / non-JSON response`);
  }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function upsertGithubComment(ctx: GithubPrContext, body: string): Promise<'created' | 'updated'> {
  const headers = githubHeaders(ctx.token);
  const listUrl = `${ctx.apiUrl}/repos/${ctx.repo}/issues/${ctx.prNumber}/comments?per_page=100`;
  const comments = (await apiRequest(listUrl, headers)) as readonly {
    id: number;
    body?: string;
  }[];
  const existing = Array.isArray(comments)
    ? comments.find((c) => c.body !== undefined && c.body.includes(COMMENT_MARKER))
    : undefined;
  if (existing !== undefined) {
    await apiRequest(`${ctx.apiUrl}/repos/${ctx.repo}/issues/comments/${existing.id}`, headers, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
    return 'updated';
  }
  await apiRequest(`${ctx.apiUrl}/repos/${ctx.repo}/issues/${ctx.prNumber}/comments`, headers, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  return 'created';
}

async function upsertGitlabComment(ctx: GitlabMrContext, body: string): Promise<'created' | 'updated'> {
  const headers = { 'PRIVATE-TOKEN': ctx.token, 'Content-Type': 'application/json' };
  const base = `${ctx.apiUrl}/projects/${encodeURIComponent(ctx.projectId)}/merge_requests/${ctx.mrIid}/notes`;
  const notes = (await apiRequest(`${base}?per_page=100`, headers)) as readonly {
    id: number;
    body?: string;
  }[];
  const existing = Array.isArray(notes)
    ? notes.find((n) => n.body !== undefined && n.body.includes(COMMENT_MARKER))
    : undefined;
  if (existing !== undefined) {
    await apiRequest(`${base}/${existing.id}`, headers, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    });
    return 'updated';
  }
  await apiRequest(base, headers, { method: 'POST', body: JSON.stringify({ body }) });
  return 'created';
}

/** Crée ou met à jour le commentaire sticky. Le corps DOIT contenir le marqueur. */
export function upsertPrComment(ctx: PrContext, body: string): Promise<'created' | 'updated'> {
  return ctx.provider === 'github' ? upsertGithubComment(ctx, body) : upsertGitlabComment(ctx, body);
}
