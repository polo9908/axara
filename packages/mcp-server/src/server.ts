/**
 * A11yEngine MCP server.
 *
 * Exposes two tools — `get_design_system_rules` and `validate_component_code` —
 * and ships the accessibility system prompt both as server `instructions`
 * (surfaced on initialize) and as a callable prompt.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ACCESSIBILITY_SYSTEM_PROMPT } from './prompt.js';
import { getDesignSystemRules } from './tools/get-design-system-rules.js';
import { validateComponentCode } from './tools/validate-component-code.js';

export const SERVER_NAME = 'a11yengine';
export const SERVER_VERSION = '0.0.0';

function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `Erreur : ${message}` }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: ACCESSIBILITY_SYSTEM_PROMPT,
      capabilities: { tools: {}, prompts: {} },
    },
  );

  server.registerTool(
    'get_design_system_rules',
    {
      title: 'Lire les règles du Design System',
      description:
        "Lit le fichier de tokens DTCG du projet et renvoie les tokens (couleurs, espacements…) avec leur référence `var(--token)` à utiliser dans le code généré.",
      inputSchema: {
        tokensPath: z
          .string()
          .optional()
          .describe('Chemin du fichier DTCG (sinon: $A11YENGINE_TOKENS ou détection auto).'),
      },
    },
    ({ tokensPath }) => {
      try {
        return jsonResult(getDesignSystemRules(tokensPath !== undefined ? { tokensPath } : {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'validate_component_code',
    {
      title: 'Valider la structure RGAA d’un composant',
      description:
        'Prend un snippet React/Vue/HTML, le normalise en HTML, exécute l’audit RGAA (axe-core) sur sa structure, vérifie le design drift (React) et renvoie un verdict de conformité + une déclaration Ara.',
      inputSchema: {
        code: z.string().describe('Le code du composant à valider.'),
        framework: z
          .enum(['react', 'vue', 'html', 'auto'])
          .optional()
          .describe('Framework du snippet (par défaut : détection automatique).'),
        tokensPath: z.string().optional().describe('Chemin du fichier DTCG pour la vérification du drift.'),
        checkDrift: z.boolean().optional().describe('Activer la détection de design drift (défaut : true).'),
        scope: z
          .enum(['component', 'page'])
          .optional()
          .describe('`component` (défaut) ignore les règles RGAA de niveau page (titre h1, landmarks…).'),
      },
    },
    async ({ code, framework, tokensPath, checkDrift, scope }) => {
      try {
        const result = await validateComponentCode({
          code,
          ...(framework !== undefined ? { framework } : {}),
          ...(tokensPath !== undefined ? { tokensPath } : {}),
          ...(checkDrift !== undefined ? { checkDrift } : {}),
          ...(scope !== undefined ? { scope } : {}),
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerPrompt(
    'accessibility_engineer',
    {
      title: 'Ingénieur accessibilité (RGAA)',
      description: 'Prompt système imposant l’usage des tokens et des attributs ARIA requis.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: ACCESSIBILITY_SYSTEM_PROMPT },
        },
      ],
    }),
  );

  return server;
}
