/**
 * Claude API client for the opt-in AI fix pass (`axaraaudit fix --ai`).
 *
 * Raw fetch on POST /v1/messages — the CLI stays dependency-free. The file
 * content IS sent to the Anthropic API, which is why this path only runs
 * when the user explicitly opts in with --ai and has configured a key.
 */

import { USER_AGENT } from '../version.js';

export const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_MODEL = 'claude-opus-4-8';
export const ANTHROPIC_KEY_ENV = 'ANTHROPIC_API_KEY';

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface AiFixRequest {
  /** Project-relative path, shown to the model for context. */
  readonly file: string;
  /** Full source of the file. */
  readonly source: string;
  /** Human-readable list of problems to fix (one per line). */
  readonly issues: readonly string[];
  /** Available design tokens, as `--css-var: value` lines. */
  readonly tokensCatalog: string;
}

export interface AiFixResult {
  /** The corrected full file content. */
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
}

const SYSTEM_PROMPT = `Tu es un ingénieur expert en accessibilité web (RGAA 4.1 / WCAG 2.1 AA) et en design systems.
On te donne un fichier source, la liste de ses non-conformités, et le catalogue des design tokens du projet.

Règles impératives :
- Corrige UNIQUEMENT les problèmes listés. Ne réécris pas, ne reformate pas, ne "améliore" pas le reste du fichier.
- Pour l'accessibilité : ajoute les attributs manquants (alt descriptif plausible, aria-label, label/htmlFor, rôles), corrige la hiérarchie de titres, rends les liens explicites. N'invente pas de contenu au-delà du strict nécessaire.
- Pour les couleurs/espacements sans token : choisis le token existant le plus proche dans le catalogue si l'écart est raisonnable, sinon conserve la valeur telle quelle.
- Conserve exactement l'indentation, les commentaires et le style du fichier.
- Réponds avec UNIQUEMENT le fichier corrigé complet dans un seul bloc de code (\`\`\`), sans aucune explication avant ou après.`;

export function buildUserPrompt(request: AiFixRequest): string {
  return [
    `Fichier : ${request.file}`,
    '',
    'Problèmes à corriger :',
    ...request.issues.map((issue) => `- ${issue}`),
    '',
    'Design tokens disponibles :',
    request.tokensCatalog,
    '',
    'Source du fichier :',
    '```',
    request.source,
    '```',
  ].join('\n');
}

/** Extract the corrected file from the model's fenced code block. */
export function extractCodeBlock(text: string): string | null {
  const match = /```[a-zA-Z]*\r?\n([\s\S]*?)```/.exec(text);
  if (!match || match[1] === undefined) return null;
  const content = match[1];
  return content.trim() === '' ? null : content;
}

interface MessagesResponse {
  readonly content?: readonly { readonly type: string; readonly text?: string }[];
  readonly stop_reason?: string;
  readonly model?: string;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  readonly error?: { readonly type?: string; readonly message?: string };
}

export interface RequestFileFixOptions {
  readonly model?: string;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
}

/** Ask Claude for a corrected version of one file. */
export async function requestFileFix(
  apiKey: string,
  request: AiFixRequest,
  options: RequestFileFixOptions = {},
): Promise<AiFixResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const model = options.model ?? CLAUDE_MODEL;

  let response: Response;
  try {
    response = await doFetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(request) }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ClaudeError(`API Anthropic injoignable : ${reason}`);
  }

  const data = (await response.json().catch(() => ({}))) as MessagesResponse;

  if (!response.ok) {
    const detail = data.error?.message ?? `HTTP ${response.status}`;
    if (response.status === 401) {
      throw new ClaudeError(
        `Clé API Anthropic refusée (${detail}). Vérifiez ANTHROPIC_API_KEY ou relancez \`axaraaudit login --anthropic-key\`.`,
        401,
      );
    }
    if (response.status === 429) {
      throw new ClaudeError(`Limite de débit Anthropic atteinte — réessayez dans un instant. (${detail})`, 429);
    }
    if (response.status === 529 || response.status >= 500) {
      throw new ClaudeError(`API Anthropic temporairement surchargée — réessayez. (${detail})`, response.status);
    }
    throw new ClaudeError(`Erreur API Anthropic : ${detail}`, response.status);
  }

  if (data.stop_reason === 'refusal') {
    throw new ClaudeError(`Le modèle a refusé la requête pour ${request.file}.`);
  }
  if (data.stop_reason === 'max_tokens') {
    throw new ClaudeError(
      `Réponse tronquée pour ${request.file} (fichier trop volumineux pour une correction IA).`,
    );
  }

  const text = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  const content = extractCodeBlock(text);
  if (content === null) {
    throw new ClaudeError(`Réponse inexploitable du modèle pour ${request.file} (aucun bloc de code).`);
  }

  return {
    content,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    model: data.model ?? model,
  };
}
