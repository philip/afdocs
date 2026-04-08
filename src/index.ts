// Public API
export type {
  CheckResult,
  CheckStatus,
  CheckContext,
  CheckOptions,
  CheckFunction,
  CheckDefinition,
  RunnerOptions,
  ReportResult,
  AgentDocsConfig,
  DiscoveredFile,
  SizeThresholds,
  CuratedPageEntry,
  PageConfigEntry,
} from './types.js';

export { DEFAULT_OPTIONS, DEFAULT_THRESHOLDS, CATEGORIES } from './constants.js';
export { createContext, normalizeUrl, runChecks } from './runner.js';
export { createHttpClient } from './http.js';
export { getAllChecks, getCheck, getChecksSorted, extractMarkdownLinks } from './checks/index.js';

// Scoring
export { computeScore, toGrade } from './scoring/index.js';
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
} from './scoring/types.js';
