export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip' | 'error';

export interface CheckResult {
  id: string;
  category: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
  dependsOn?: string[];
}

export interface CheckContext {
  /** The base URL being checked (as provided by the user). */
  baseUrl: string;
  /** The origin (scheme + host) derived from baseUrl. */
  origin: string;
  /** Results from previously-run checks, keyed by check ID. */
  previousResults: Map<string, CheckResult>;
  /** HTTP client with rate limiting. */
  http: HttpClient;
  /** Runtime options. */
  options: CheckOptions;
}

export interface CheckOptions {
  /** Maximum concurrent HTTP requests within a single check. */
  maxConcurrency: number;
  /** Delay in ms between HTTP requests. */
  requestDelay: number;
  /** Timeout in ms for individual HTTP requests. */
  requestTimeout: number;
  /** Maximum number of links to test in link-resolution checks. */
  maxLinksToTest: number;
  /** Size thresholds. */
  thresholds: SizeThresholds;
}

export interface SizeThresholds {
  /** Characters below which content passes (default 50,000). */
  pass: number;
  /** Characters above which content fails (default 100,000). */
  fail: number;
}

export type CheckFunction = (ctx: CheckContext) => Promise<CheckResult>;

export interface CheckDefinition {
  id: string;
  category: string;
  description: string;
  /** Check IDs that must pass before this check runs. Array of arrays for OR-groups. */
  dependsOn: string[][] | string[];
  run: CheckFunction;
}

export interface HttpClient {
  fetch(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  redirect?: 'follow' | 'manual';
  signal?: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  redirected: boolean;
  text(): Promise<string>;
}

export interface DiscoveredFile {
  url: string;
  content: string;
  status: number;
  redirected: boolean;
  redirectUrl?: string;
  crossHostRedirect?: boolean;
}

export interface RunnerOptions extends CheckOptions {
  /** Only run checks matching these IDs. If empty, run all. */
  checkIds?: string[];
}

export interface ReportResult {
  url: string;
  timestamp: string;
  results: CheckResult[];
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    skip: number;
    error: number;
  };
}

export interface AgentDocsConfig {
  url: string;
  checks?: string[];
  options?: Partial<CheckOptions>;
}
