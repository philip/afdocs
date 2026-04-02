import type { CheckContext, CheckResult, RunnerOptions, ReportResult } from './types.js';
import { DEFAULT_OPTIONS, SPEC_BASE_URL } from './constants.js';
import { createHttpClient } from './http.js';
import { getChecksSorted } from './checks/registry.js';

/**
 * Normalize dependsOn to the internal format: array of OR-groups.
 * - `['a', 'b']` means a AND b (each is its own OR-group of 1)
 * - `[['a', 'b']]` means a OR b (single OR-group with 2 options)
 */
function normalizeDeps(deps: string[][] | string[]): string[][] {
  if (deps.length === 0) return [];
  if (typeof deps[0] === 'string') {
    // Simple array: each element is a required dependency
    return (deps as string[]).map((d) => [d]);
  }
  return deps as string[][];
}

function checkDependenciesMet(
  deps: string[][] | string[],
  previousResults: Map<string, CheckResult>,
): boolean {
  const normalized = normalizeDeps(deps);
  for (const orGroup of normalized) {
    // At least one check in the OR-group must have passed (or warned)
    const anyPassed = orGroup.some((id) => {
      const result = previousResults.get(id);
      return result?.status === 'pass' || result?.status === 'warn';
    });
    if (!anyPassed) return false;
  }
  return true;
}

export function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

export function createContext(baseUrl: string, options?: Partial<RunnerOptions>): CheckContext {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  baseUrl = normalizeUrl(baseUrl);
  const url = new URL(baseUrl);

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    origin: url.origin,
    previousResults: new Map(),
    http: createHttpClient({
      requestDelay: merged.requestDelay,
      requestTimeout: merged.requestTimeout,
      maxConcurrency: merged.maxConcurrency,
    }),
    options: merged,
    pageCache: new Map(),
    htmlCache: new Map(),
  };
}

export async function runChecks(
  baseUrl: string,
  options?: Partial<RunnerOptions>,
): Promise<ReportResult> {
  const ctx = createContext(baseUrl, options);
  const allChecks = getChecksSorted();
  const checkIds = options?.checkIds;

  const results: CheckResult[] = [];

  for (const check of allChecks) {
    // Filter by requested check IDs if provided
    if (checkIds && checkIds.length > 0 && !checkIds.includes(check.id)) {
      continue;
    }

    // Check dependencies — only skip if at least one dependency actually ran and none passed.
    // If no dependencies ran at all (e.g. filtered out via --checks), let the check handle
    // standalone mode itself.
    if (check.dependsOn.length > 0) {
      const normalized = normalizeDeps(check.dependsOn);
      const anyDepRan = normalized.some((orGroup) =>
        orGroup.some((id) => ctx.previousResults.has(id)),
      );
      if (anyDepRan && !checkDependenciesMet(check.dependsOn, ctx.previousResults)) {
        const result: CheckResult = {
          id: check.id,
          category: check.category,
          status: 'skip',
          message: 'Skipped: dependency check did not pass',
          dependsOn: normalized.flat(),
        };
        results.push(result);
        ctx.previousResults.set(check.id, result);
        continue;
      }
    }

    try {
      const result = await check.run(ctx);
      results.push(result);
      ctx.previousResults.set(check.id, result);
    } catch (err) {
      const result: CheckResult = {
        id: check.id,
        category: check.category,
        status: 'error',
        message: `Check error: ${err instanceof Error ? err.message : String(err)}`,
      };
      results.push(result);
      ctx.previousResults.set(check.id, result);
    }
  }

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'pass').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
    error: results.filter((r) => r.status === 'error').length,
  };

  return {
    url: baseUrl,
    timestamp: new Date().toISOString(),
    specUrl: SPEC_BASE_URL,
    results,
    summary,
  };
}
