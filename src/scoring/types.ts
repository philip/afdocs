export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type DiagnosticSeverity = 'critical' | 'warning' | 'info';

export interface CheckScore {
  /** Base weight from the tier assignment. */
  baseWeight: number;
  /** Product of all applicable cluster coefficients (1.0 if none). */
  coefficient: number;
  /** baseWeight * coefficient */
  effectiveWeight: number;
  /** 0–1 proportion from page-level detail (1.0 for single-resource pass). */
  proportion: number;
  /** proportion * effectiveWeight */
  earnedScore: number;
  /** effectiveWeight (the maximum this check could earn). */
  maxScore: number;
}

export interface CategoryScore {
  score: number;
  grade: Grade;
}

export interface ScoreCap {
  /** The cap value applied. */
  cap: number;
  /** The check that triggered the cap. */
  checkId: string;
  /** Why this cap was applied. */
  reason: string;
}

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  resolution: string;
}

export interface ScoreResult {
  overall: number;
  grade: Grade;
  /** Present when a critical check cap reduced the score. */
  cap?: ScoreCap;
  categoryScores: Record<string, CategoryScore>;
  checkScores: Record<string, CheckScore>;
  diagnostics: Diagnostic[];
  /** Per-check resolution text for warn/fail checks, keyed by check ID. */
  resolutions: Record<string, string>;
}
