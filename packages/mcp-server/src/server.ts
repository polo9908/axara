/**
 * A11yEngine MCP server.
 *
 * Five tools — `get_design_system_rules`, `validate_component_code`,
 * `audit_project`, `fix_drift`, `explain_rule` — plus three resources
 * (`axara://design-tokens`, `axara://config`, `axara://report/latest`) and the
 * accessibility system prompt, shipped both as server `instructions` and as a
 * callable prompt. Every tool declares an `outputSchema` (results also arrive
 * as `structuredContent`) and behavior annotations so clients can plan
 * permissions: everything is read-only except `fix_drift` with `write: true`.
 */

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadRc } from '@axaraaudit/core';
import { z } from 'zod';
import { ACCESSIBILITY_SYSTEM_PROMPT } from './prompt.js';
import { getLastReport } from './report-store.js';
import {
  getDesignSystemRules,
  GET_DESIGN_SYSTEM_RULES_OUTPUT,
} from './tools/get-design-system-rules.js';
import {
  validateComponentCode,
  VALIDATE_COMPONENT_CODE_OUTPUT,
} from './tools/validate-component-code.js';
import {
  runAuditProject,
  AUDIT_PROJECT_INPUT,
  AUDIT_PROJECT_OUTPUT,
} from './tools/audit-project.js';
import { runFixDrift, FIX_DRIFT_INPUT, FIX_DRIFT_OUTPUT } from './tools/fix-drift.js';
import { runExplainRule, EXPLAIN_RULE_INPUT, EXPLAIN_RULE_OUTPUT } from './tools/explain-rule.js';
import { resolveTokensPath } from './tokens-source.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export { SERVER_NAME, SERVER_VERSION } from './version.js';

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
      capabilities: { tools: {}, prompts: {}, resources: {} },
    },
  );

  // ── Tools ──────────────────────────────────────────────────────────────

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
      outputSchema: GET_DESIGN_SYSTEM_RULES_OUTPUT,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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
      outputSchema: VALIDATE_COMPONENT_CODE_OUTPUT,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
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

  server.registerTool(
    'audit_project',
    {
      title: 'Auditer le projet complet (drift + RGAA)',
      description:
        'Lance l’audit AxaraAudit complet sur un répertoire projet : design drift contre les tokens DTCG + violations RGAA (axe-core), avec le score 0–100 et le verdict de gate — exactement le même calcul que `axaraaudit audit`. Réponse compacte (pires problèmes d’abord) ; rapport intégral via la resource axara://report/latest.',
      inputSchema: AUDIT_PROJECT_INPUT,
      outputSchema: AUDIT_PROJECT_OUTPUT,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        return jsonResult(await runAuditProject(input));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'fix_drift',
    {
      title: 'Corriger le design drift (tokens)',
      description:
        'Applique les corrections mécaniques de design drift (valeurs exactement égales à un token → `var(--token)`, vérifiées position par position). Dry-run par défaut : rien n’est écrit sans `write: true`. Ne corrige jamais le RGAA (décision humaine).',
      inputSchema: FIX_DRIFT_INPUT,
      outputSchema: FIX_DRIFT_OUTPUT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => {
      try {
        return jsonResult(runFixDrift(input));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'explain_rule',
    {
      title: 'Expliquer un critère RGAA',
      description:
        'Renvoie les métadonnées d’un critère RGAA 4.1 (thème, intitulé officiel, critères WCAG référencés) et les règles axe-core mappées dessus. Accepte aussi un numéro de thème (ex. "11") pour lister tous ses critères couverts.',
      inputSchema: EXPLAIN_RULE_INPUT,
      outputSchema: EXPLAIN_RULE_OUTPUT,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (input) => {
      try {
        return jsonResult(runExplainRule(input));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── Resources ──────────────────────────────────────────────────────────

  server.registerResource(
    'design-tokens',
    'axara://design-tokens',
    {
      title: 'Design tokens (DTCG)',
      description:
        'Le document DTCG brut du projet — la source de vérité des couleurs et espacements.',
      mimeType: 'application/json',
    },
    (uri) => {
      const path = resolveTokensPath({});
      if (path === null) {
        throw new Error(
          'Aucun fichier de tokens DTCG trouvé (design-tokens.dtcg.json, $A11YENGINE_TOKENS…).',
        );
      }
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: readFileSync(path, 'utf8') },
        ],
      };
    },
  );

  server.registerResource(
    'config',
    'axara://config',
    {
      title: 'Configuration résolue (.auditorrc.json)',
      description:
        'La configuration AxaraAudit effective du répertoire courant, défauts inclus.',
      mimeType: 'application/json',
    },
    (uri) => {
      const loaded = loadRc(process.cwd());
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              { rcPath: loaded.rcPath, rootDir: loaded.rootDir, rc: loaded.rc },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    'latest-report',
    'axara://report/latest',
    {
      title: 'Dernier rapport d’audit complet',
      description:
        'Le payload intégral du dernier `audit_project` de cette session (toutes les violations, non tronquées).',
      mimeType: 'application/json',
    },
    (uri) => {
      const report = getLastReport();
      if (report === null) {
        throw new Error('Aucun audit dans cette session — appelle d’abord le tool audit_project.');
      }
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(report, null, 2) },
        ],
      };
    },
  );

  // ── Prompt ─────────────────────────────────────────────────────────────

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
