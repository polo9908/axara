/**
 * In-memory cache of the last full audit payload, so the `axara://report/latest`
 * resource can serve the complete report while the `audit_project` tool result
 * stays compact (token economy for the calling agent).
 */

import type { AuditPayload } from '@axaraaudit/core';

let lastReport: AuditPayload | null = null;

export function setLastReport(payload: AuditPayload): void {
  lastReport = payload;
}

export function getLastReport(): AuditPayload | null {
  return lastReport;
}
