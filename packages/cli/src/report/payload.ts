/**
 * The audit payload contract now lives in @axaraaudit/core (shared with the
 * MCP server and the Pro API). This module re-exports it under the CLI's
 * historical path; the CLI stamps its identity via `auditProject` options.
 */

export {
  PAYLOAD_VERSION,
  aggregateRgaa,
  buildAuditPayload,
  type AuditPayload,
  type RgaaAggregate,
  type BuildAuditPayloadArgs,
} from '@axaraaudit/core';
