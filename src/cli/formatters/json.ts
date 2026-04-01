import type { ReportResult } from '../../types.js';
import type { ScoreResult } from '../../scoring/types.js';
import { computeScore } from '../../scoring/index.js';

export interface FormatJsonOptions {
  score?: boolean;
}

export function formatJson(report: ReportResult, options?: FormatJsonOptions): string {
  if (options?.score) {
    const scoring: ScoreResult = computeScore(report);
    return JSON.stringify({ ...report, scoring }, null, 2);
  }
  return JSON.stringify(report, null, 2);
}
