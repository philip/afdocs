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
} from './types.js';

export { DEFAULT_OPTIONS, DEFAULT_THRESHOLDS, CATEGORIES } from './constants.js';
export { createContext, runChecks } from './runner.js';
export { createHttpClient } from './http.js';
export { getAllChecks, getCheck, getChecksSorted, extractMarkdownLinks } from './checks/index.js';
