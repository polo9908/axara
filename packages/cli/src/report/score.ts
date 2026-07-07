/**
 * Score and gate evaluation now live in @axaraaudit/core so every surface
 * (CLI, MCP server) computes the exact same number. This module re-exports
 * them under the CLI's historical path.
 */

export {
  computeScore,
  evaluateGate,
  type FileRgaaFinding,
  type GateOptions,
  type GateResult,
} from '@axaraaudit/core';
