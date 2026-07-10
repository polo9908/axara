import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from './server.js';

/**
 * Integration: drive the server through a real MCP Client over a linked
 * in-memory transport pair — exercises the JSON-RPC 2.0 wiring end-to-end.
 * Note: the client validates every tool result against its outputSchema, so
 * these calls also prove structuredContent conforms to the declared schemas.
 */
async function connectedClient(): Promise<Client> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** A small project with one auto-fixable drift and one RGAA violation. */
function seedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a11yengine-project-'));
  writeFileSync(
    join(dir, 'design-tokens.dtcg.json'),
    JSON.stringify({
      color: { $type: 'color', brand: { $value: '#3b82f6' } },
      space: { $type: 'dimension', sm: { $value: '8px' } },
    }),
  );
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'app.css'), '.btn { color: #3b82f6; padding: 8px; }\n');
  writeFileSync(join(dir, 'src', 'App.tsx'), 'export const App = () => <img src="a.png" />;\n');
  return dir;
}

const projectDir = seedProject();

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('A11yEngine MCP server', () => {
  it('advertises the accessibility system prompt as instructions', async () => {
    const client = await connectedClient();
    const instructions = client.getInstructions();
    expect(instructions).toMatch(/ingénieur accessibilité/i);
    expect(instructions).toMatch(/var\(--token\)/);
    expect(instructions).toMatch(/audit_project/);
    await client.close();
  });

  it('lists the five tools, each with input and output schemas', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'audit_project',
      'explain_rule',
      'fix_drift',
      'get_design_system_rules',
      'validate_component_code',
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema, `${tool.name} must declare an outputSchema`).toBeDefined();
    }
    const validate = tools.find((t) => t.name === 'validate_component_code')!;
    expect(validate.inputSchema.properties).toHaveProperty('code');
    await client.close();
  });

  it('annotates fix_drift as the only non-read-only tool', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const readOnly = tool.annotations?.readOnlyHint;
      if (tool.name === 'fix_drift') expect(readOnly).toBe(false);
      else expect(readOnly, `${tool.name} should be read-only`).toBe(true);
    }
    await client.close();
  });

  it('exposes the accessibility_engineer prompt', async () => {
    const client = await connectedClient();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('accessibility_engineer');
    const prompt = await client.getPrompt({ name: 'accessibility_engineer' });
    expect(prompt.messages[0]!.content.type).toBe('text');
    await client.close();
  });

  it('calls validate_component_code and returns a structured RGAA verdict', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'validate_component_code',
      arguments: { code: `const A = () => <a href="/x"></a>;`, checkDrift: false },
    });
    const structured = result.structuredContent as { verdict: { conformant: boolean }; rgaa: { findings: unknown[] } };
    expect(structured.verdict.conformant).toBe(false);
    expect(Array.isArray(structured.rgaa.findings)).toBe(true);
    await client.close();
  });

  it('returns a helpful error for get_design_system_rules without tokens', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'get_design_system_rules',
      arguments: { tokensPath: '/definitely/not/here.json' },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it('audits a whole project and serves the full report as a resource', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'audit_project',
      arguments: { projectDir },
    });
    const audit = result.structuredContent as {
      score: number;
      drift: { summary: { autoFixable: number } };
      rgaa: { findings: { criterion: string }[] };
      tokensSource: { origin: string };
    };
    expect(audit.score).toBeLessThan(100);
    expect(audit.tokensSource.origin).toBe('file');
    expect(audit.drift.summary.autoFixable).toBeGreaterThan(0);
    expect(audit.rgaa.findings.some((f) => f.criterion === '1.1')).toBe(true);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('axara://report/latest');
    const report = await client.readResource({ uri: 'axara://report/latest' });
    const payload = JSON.parse(report.contents[0]!.text as string) as {
      tool: string;
      payloadVersion: number;
      score: number;
    };
    expect(payload.tool).toBe('a11yengine');
    expect(payload.payloadVersion).toBe(2);
    expect(payload.score).toBe(audit.score);
    await client.close();
  });

  it('previews drift fixes without writing, then applies them with write: true', async () => {
    const client = await connectedClient();
    const cssPath = join(projectDir, 'src', 'app.css');
    const before = readFileSync(cssPath, 'utf8');

    const preview = await client.callTool({
      name: 'fix_drift',
      arguments: { projectDir },
    });
    const dry = preview.structuredContent as { mode: string; totalApplied: number };
    expect(dry.mode).toBe('dry-run');
    expect(dry.totalApplied).toBeGreaterThan(0);
    expect(readFileSync(cssPath, 'utf8')).toBe(before);

    const applied = await client.callTool({
      name: 'fix_drift',
      arguments: { projectDir, write: true },
    });
    const wet = applied.structuredContent as { mode: string; files: { written: boolean }[] };
    expect(wet.mode).toBe('write');
    expect(wet.files.every((f) => f.written)).toBe(true);
    expect(readFileSync(cssPath, 'utf8')).toContain('var(--color-brand)');
    await client.close();
  });

  it('explains an RGAA criterion and expands a bare theme number', async () => {
    const client = await connectedClient();
    const single = await client.callTool({
      name: 'explain_rule',
      arguments: { criterion: '1.1' },
    });
    const one = single.structuredContent as {
      criteria: { documented: boolean; axeRules: string[]; wcag: string[] }[];
    };
    expect(one.criteria).toHaveLength(1);
    expect(one.criteria[0]!.documented).toBe(true);
    expect(one.criteria[0]!.axeRules).toContain('image-alt');
    expect(one.criteria[0]!.wcag).toContain('1.1.1');

    const theme = await client.callTool({
      name: 'explain_rule',
      arguments: { criterion: '11' },
    });
    const many = theme.structuredContent as { criteria: { theme: number }[] };
    expect(many.criteria.length).toBeGreaterThan(1);
    expect(many.criteria.every((c) => c.theme === 11)).toBe(true);
    await client.close();
  });
});
