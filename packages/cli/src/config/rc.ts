/**
 * `.auditorrc.json` handling now lives in @axaraaudit/core (shared with the
 * MCP server). This module re-exports it under the CLI's historical paths.
 */

export {
  RC_FILENAME,
  ConfigError,
  DEFAULT_RC,
  mergeRc,
  loadRc,
  resolveRcTokensPath as resolveTokensPath,
  type RgaaConfig,
  type CiConfig,
  type ProConfig,
  type AuditorRc,
  type AuditorRcInput,
  type LoadedRc,
} from '@axaraaudit/core';
