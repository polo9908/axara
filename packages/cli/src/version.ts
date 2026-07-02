/** CLI identity, shared by help output and the API user-agent. */

import { createRequire } from 'node:module';

// Read the version from package.json at runtime so `--version` can never
// drift from the published version (dist/version.js → ../package.json).
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const CLI_VERSION = pkg.version;
export const CLI_NAME = 'axaraaudit';
export const USER_AGENT = `${CLI_NAME}-cli/${CLI_VERSION}`;
