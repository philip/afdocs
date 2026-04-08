export { computeScore } from './score.js';
export { toGrade } from './score.js';
export { CHECK_WEIGHTS, AGENT_TRUNCATION_LIMIT } from './weights.js';
export { evaluateDiagnostics } from './diagnostics.js';
export { getResolution } from './resolutions.js';
export { getCheckProportion } from './proportions.js';
export { getCoefficient } from './coefficients.js';
export { computeTagScores } from './tag-scores.js';

export type {
  ScoreResult,
  CheckScore,
  CategoryScore,
  TagScore,
  TagCheckBreakdown,
  ScoreCap,
  Diagnostic,
  DiagnosticSeverity,
  Grade,
} from './types.js';
