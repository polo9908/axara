/** Server identity, stamped into audit payloads and the MCP handshake. */

import { createRequire } from 'node:module';

// Read the version from package.json at runtime so the advertised version can
// never drift from the published one (dist/version.js → ../package.json).
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const SERVER_NAME = 'a11yengine';
export const SERVER_VERSION = pkg.version;
