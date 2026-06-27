// Real stdio smoke test: spawn the built MCP server as a child process and drive
// it through the official MCP client (JSON-RPC 2.0 over stdio).
// Run from the package: `node scripts/stdio-smoke.mjs` (after `pnpm build`).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const tokensPath = fileURLToPath(new URL('../../../examples/design-tokens.dtcg.json', import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, A11YENGINE_TOKENS: tokensPath },
});

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

console.log('Server instructions (excerpt):');
console.log('  ' + (client.getInstructions() ?? '').split('\n')[0]);

const { tools } = await client.listTools();
console.log('\nTools:', tools.map((t) => t.name).join(', '));

const rules = await client.callTool({ name: 'get_design_system_rules', arguments: {} });
const rulesData = rules.structuredContent;
console.log(`\nget_design_system_rules → ${rulesData.count} tokens from ${rulesData.tokensPath}`);
console.log('  e.g.', rulesData.colors[0]?.path, '→', rulesData.colors[0]?.reference);

const validation = await client.callTool({
  name: 'validate_component_code',
  arguments: {
    code: `const Btn = ({label}) => <button style={{ color: '#3c83f7', padding: 8 }}>{label}</button>;`,
  },
});
const v = validation.structuredContent;
console.log('\nvalidate_component_code →');
console.log('  framework:', v.framework, '| conformant:', v.verdict.conformant);
console.log('  normalizedHtml:', v.normalizedHtml);
console.log('  RGAA findings:', v.rgaa.findings.map((f) => `${f.criterion}/${f.axeRuleId}`).join(', ') || '(none)');
console.log('  drift:', v.drift.map((d) => `${d.property}:${d.value}→${d.suggestion?.replacement}`).join(', ') || '(none)');

await client.close();
console.log('\nOK — MCP server answered over stdio.');
