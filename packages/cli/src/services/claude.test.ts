import { describe, expect, it } from 'vitest';
import {
  buildUserPrompt,
  extractCodeBlock,
  requestFileFix,
  ClaudeError,
} from './claude.js';
import { tr } from '../i18n.js';

const REQUEST = {
  file: 'src/Header.jsx',
  source: '<img src="/logo.svg" />',
  issues: ['RGAA 1.1 — image sans alternative textuelle'],
  tokensCatalog: '--color-primary: #1A3C6E',
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('buildUserPrompt', () => {
  it('includes the file, issues, tokens and source', () => {
    const prompt = buildUserPrompt(REQUEST);
    expect(prompt).toContain('src/Header.jsx');
    expect(prompt).toContain('RGAA 1.1');
    expect(prompt).toContain('--color-primary');
    expect(prompt).toContain('<img src="/logo.svg" />');
  });
});

describe('extractCodeBlock', () => {
  it('extracts a fenced block with a language tag', () => {
    expect(extractCodeBlock('```jsx\nconst a = 1;\n```')).toBe('const a = 1;\n');
  });

  it('returns null when there is no block or it is empty', () => {
    expect(extractCodeBlock('pas de code ici')).toBeNull();
    expect(extractCodeBlock('```\n\n```')).toBeNull();
  });
});

describe('requestFileFix', () => {
  it('returns the corrected content and usage on success', async () => {
    const result = await requestFileFix('sk-test', REQUEST, {
      fetchImpl: fakeFetch(200, {
        content: [{ type: 'text', text: '```jsx\n<img src="/logo.svg" alt="Logo" />\n```' }],
        stop_reason: 'end_turn',
        model: 'claude-opus-4-8',
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });
    expect(result.content).toContain('alt="Logo"');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('maps a 401 to an actionable error', async () => {
    await expect(
      requestFileFix('sk-bad', REQUEST, {
        fetchImpl: fakeFetch(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
      }),
    ).rejects.toThrowError(tr('Clé API Anthropic refusée', 'Anthropic API key rejected'));
  });

  it('fails clearly on a truncated (max_tokens) response', async () => {
    await expect(
      requestFileFix('sk-test', REQUEST, {
        fetchImpl: fakeFetch(200, {
          content: [{ type: 'text', text: '```\npartial' }],
          stop_reason: 'max_tokens',
        }),
      }),
    ).rejects.toThrowError(tr('tronquée', 'Truncated'));
  });

  it('fails clearly when no code block is returned', async () => {
    await expect(
      requestFileFix('sk-test', REQUEST, {
        fetchImpl: fakeFetch(200, {
          content: [{ type: 'text', text: 'Voici mes suggestions : ...' }],
          stop_reason: 'end_turn',
        }),
      }),
    ).rejects.toThrowError(ClaudeError);
  });
});
