import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';

/**
 * Integration: drive the server through a real MCP Client over a linked
 * in-memory transport pair — exercises the JSON-RPC 2.0 wiring end-to-end.
 */
async function connectedClient(): Promise<Client> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('A11yEngine MCP server', () => {
  it('advertises the accessibility system prompt as instructions', async () => {
    const client = await connectedClient();
    const instructions = client.getInstructions();
    expect(instructions).toMatch(/ingénieur accessibilité/i);
    expect(instructions).toMatch(/var\(--token\)/);
    await client.close();
  });

  it('lists both tools with input schemas', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_design_system_rules', 'validate_component_code']);
    const validate = tools.find((t) => t.name === 'validate_component_code')!;
    expect(validate.inputSchema.properties).toHaveProperty('code');
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
});
