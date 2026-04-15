import { registerCheck } from '../registry.js';
import { discoverAndSamplePages } from '../../helpers/get-page-urls.js';
import { SOFT_404_PATTERNS } from '../../helpers/detect-soft-404.js';
import type { CheckContext, CheckResult } from '../../types.js';

interface StatusCodeResult {
  url: string;
  testUrl: string;
  status: number | null;
  classification: 'correct-error' | 'soft-404' | 'fetch-error';
  redirected?: boolean;
  finalUrl?: string;
  bodyHint?: string;
  error?: string;
}

/** Generate a sibling URL that almost certainly doesn't exist. */
function makeBadUrl(pageUrl: string): string {
  const u = new URL(pageUrl);
  u.hash = ''; // strip fragment — servers don't see it anyway
  u.pathname = u.pathname.replace(/\/?$/, '-afdocs-nonexistent-8f3a');
  return u.toString();
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'http-status-codes';
  const category = 'url-stability';

  const { urls: pageUrls, totalPages, sampled, warnings } = await discoverAndSamplePages(ctx);

  const results: StatusCodeResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<StatusCodeResult> => {
        const testUrl = makeBadUrl(url);
        try {
          // Follow redirects so we classify based on the final response.
          // A redirect chain ending in 404 is correct; one ending in 200 is a soft 404.
          const response = await ctx.http.fetch(testUrl);
          const status = response.status;
          const redirected = response.redirected || response.url !== testUrl;
          const finalUrl = redirected ? response.url : undefined;

          if (status >= 400) {
            return { url, testUrl, status, classification: 'correct-error', redirected, finalUrl };
          }

          // Status 200 (or other 2xx/3xx) — possible soft 404
          let bodyHint: string | undefined;
          try {
            const body = await response.text();
            if (SOFT_404_PATTERNS.test(body.slice(0, 5000))) {
              bodyHint = 'Body contains "not found" / "404" text';
            }
          } catch {
            // ignore body read errors
          }

          return {
            url,
            testUrl,
            status,
            classification: 'soft-404',
            redirected,
            finalUrl,
            bodyHint,
          };
        } catch (err) {
          return {
            url,
            testUrl,
            status: null,
            classification: 'fetch-error',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...batchResults);
  }

  const tested = results.filter((r) => r.classification !== 'fetch-error');
  const fetchErrors = results.filter((r) => r.classification === 'fetch-error').length;
  const soft404s = results.filter((r) => r.classification === 'soft-404');
  const correctErrors = results.filter((r) => r.classification === 'correct-error');

  if (tested.length === 0) {
    return {
      id,
      category,
      status: 'fail',
      message: `Could not test any URLs${fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : ''}`,
      details: {
        totalPages,
        testedPages: results.length,
        sampled,
        fetchErrors,
        pageResults: results,
        discoveryWarnings: warnings,
      },
    };
  }

  const status = soft404s.length > 0 ? 'fail' : 'pass';
  const pageLabel = sampled ? 'sampled pages' : 'pages';
  const suffix = fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : '';

  let message: string;
  if (status === 'pass') {
    message = `All ${tested.length} ${pageLabel} return proper error codes for bad URLs${suffix}`;
  } else {
    message = `${soft404s.length} of ${tested.length} ${pageLabel} return 200 for non-existent URLs (soft 404)${suffix}`;
  }

  return {
    id,
    category,
    status,
    message,
    details: {
      totalPages,
      testedPages: results.length,
      sampled,
      soft404Count: soft404s.length,
      correctErrorCount: correctErrors.length,
      fetchErrors,
      pageResults: results,
      discoveryWarnings: warnings,
    },
  };
}

registerCheck({
  id: 'http-status-codes',
  category: 'url-stability',
  description: 'Whether error pages return correct HTTP status codes',
  dependsOn: [],
  run: check,
});
