#!/usr/bin/env node
/**
 * A11yEngine MCP server entry point — speaks JSON-RPC 2.0 over stdio.
 *
 * Run directly (`a11yengine-mcp`) or register in an MCP client config, e.g.:
 *   { "mcpServers": { "a11yengine": { "command": "a11yengine-mcp" } } }
 */

import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

export { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the JSON-RPC stream; log lifecycle to stderr only.
  process.stderr.write(`[a11yengine] MCP server ready on stdio\n`);
}

// Only auto-start when executed as a program (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[a11yengine] fatal: ${String(error)}\n`);
    process.exit(1);
  });
}
