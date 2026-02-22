import type { ReportResult } from '../../types.js';

export function formatJson(report: ReportResult): string {
  return JSON.stringify(report, null, 2);
}
