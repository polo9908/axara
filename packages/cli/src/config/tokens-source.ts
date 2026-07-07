/**
 * Tokens resolution (with the zero-config CSS fallback) now lives in
 * @axaraaudit/core (shared with the MCP server). This module re-exports it
 * under the CLI's historical path.
 */

export {
  loadTokensSource,
  type TokensSource,
  type ScannedFile,
} from '@axaraaudit/core';
