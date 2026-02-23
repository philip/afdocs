import { registerCheck } from '../registry.js';
import { looksLikeMarkdown } from '../../helpers/detect-markdown.js';
import { discoverAndSamplePages } from '../../helpers/get-page-urls.js';
import { toMdUrls } from '../../helpers/to-md-urls.js';
import type { CheckContext, CheckResult, CheckStatus } from '../../types.js';

interface PageSizeResult {
  url: string;
  mdUrl: string;
  characters: number;
  status: CheckStatus;
  source: 'cache' | 'fallback';
  error?: string;
}

function sizeStatus(chars: number, pass: number, fail: number): CheckStatus {
  if (chars <= pass) return 'pass';
  if (chars <= fail) return 'warn';
  return 'fail';
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'page-size-markdown';
  const category = 'page-size';
  const { pass: passThreshold, fail: failThreshold } = ctx.options.thresholds;

  // Check if dependency checks ran
  const mdUrlResult = ctx.previousResults.get('markdown-url-support');
  const cnResult = ctx.previousResults.get('content-negotiation');
  const depRan = mdUrlResult || cnResult;

  if (depRan) {
    // At least one dependency check ran. Did either pass or warn?
    const depPassed =
      (mdUrlResult && (mdUrlResult.status === 'pass' || mdUrlResult.status === 'warn')) ||
      (cnResult && (cnResult.status === 'pass' || cnResult.status === 'warn'));

    if (!depPassed) {
      return {
        id,
        category,
        status: 'skip',
        message: 'Site does not serve markdown; skipping markdown size check',
      };
    }

    // Build a map from page URL → markdown URL using dependency results
    const mdUrlMap = new Map<string, string>();
    const mdUrlPages = (mdUrlResult?.details as Record<string, unknown>)?.pageResults as
      | Array<{ url: string; mdUrl: string; supported: boolean }>
      | undefined;
    if (mdUrlPages) {
      for (const p of mdUrlPages) {
        if (p.supported) mdUrlMap.set(p.url, p.mdUrl);
      }
    }

    // Use cached pages
    const pageResults: PageSizeResult[] = [];
    for (const [, cached] of ctx.pageCache) {
      if (cached.markdown) {
        const chars = cached.markdown.content.length;
        const resolvedMdUrl =
          cached.markdown.source === 'md-url'
            ? (mdUrlMap.get(cached.url) ?? cached.url)
            : cached.url;
        pageResults.push({
          url: cached.url,
          mdUrl: resolvedMdUrl,
          characters: chars,
          status: sizeStatus(chars, passThreshold, failThreshold),
          source: 'cache',
        });
      }
    }

    if (pageResults.length === 0) {
      return {
        id,
        category,
        status: 'skip',
        message: 'No cached markdown pages available to measure',
      };
    }

    return buildResult(
      id,
      category,
      pageResults,
      pageResults.length,
      false,
      passThreshold,
      failThreshold,
      [],
    );
  }

  // Standalone mode: dependency checks never ran
  const {
    urls: pageUrls,
    totalPages,
    sampled: wasSampled,
    warnings,
  } = await discoverAndSamplePages(ctx);

  const pageResults: PageSizeResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<PageSizeResult | null> => {
        // Try .md URL candidates
        const candidates = toMdUrls(url);
        for (const candidateUrl of candidates) {
          try {
            const response = await ctx.http.fetch(candidateUrl);
            if (!response.ok) continue;
            const body = await response.text();
            if (looksLikeMarkdown(body)) {
              const chars = body.length;
              return {
                url,
                mdUrl: candidateUrl,
                characters: chars,
                status: sizeStatus(chars, passThreshold, failThreshold),
                source: 'fallback',
              };
            }
          } catch {
            // Try next candidate
          }
        }

        // Try content negotiation
        try {
          const response = await ctx.http.fetch(url, {
            headers: { Accept: 'text/markdown' },
          });
          if (response.ok) {
            const body = await response.text();
            if (looksLikeMarkdown(body)) {
              const chars = body.length;
              return {
                url,
                mdUrl: url,
                characters: chars,
                status: sizeStatus(chars, passThreshold, failThreshold),
                source: 'fallback',
              };
            }
          }
        } catch {
          // No markdown available for this page
        }

        return null;
      }),
    );
    for (const r of batchResults) {
      if (r) pageResults.push(r);
    }
  }

  if (pageResults.length === 0) {
    return {
      id,
      category,
      status: 'skip',
      message: 'No markdown content found; skipping size check',
    };
  }

  return buildResult(
    id,
    category,
    pageResults,
    totalPages,
    wasSampled,
    passThreshold,
    failThreshold,
    warnings,
  );
}

function buildResult(
  id: string,
  category: string,
  pageResults: PageSizeResult[],
  totalPages: number,
  sampled: boolean,
  passThreshold: number,
  failThreshold: number,
  discoveryWarnings: string[],
): CheckResult {
  const sizes = pageResults.map((r) => r.characters).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const max = sizes[sizes.length - 1];

  const passBucket = pageResults.filter((r) => r.status === 'pass').length;
  const warnBucket = pageResults.filter((r) => r.status === 'warn').length;
  const failBucket = pageResults.filter((r) => r.status === 'fail').length;

  const overallStatus = worstStatus(pageResults.map((r) => r.status));
  const pageLabel = sampled ? 'sampled pages' : 'pages';

  const formatSize = (chars: number) => {
    if (chars >= 1000) return `${Math.round(chars / 1000)}K`;
    return String(chars);
  };

  let message: string;
  if (overallStatus === 'pass') {
    message = `All ${pageResults.length} ${pageLabel} under ${formatSize(passThreshold)} chars (median ${formatSize(median)}, max ${formatSize(max)})`;
  } else if (overallStatus === 'warn') {
    message = `${warnBucket} of ${pageResults.length} ${pageLabel} between ${formatSize(passThreshold)}–${formatSize(failThreshold)} chars (max ${formatSize(max)})`;
  } else {
    message = `${failBucket} of ${pageResults.length} ${pageLabel} exceed ${formatSize(failThreshold)} chars (max ${formatSize(max)})`;
  }

  return {
    id,
    category,
    status: overallStatus,
    message,
    details: {
      totalPages,
      testedPages: pageResults.length,
      sampled,
      median,
      max,
      passBucket,
      warnBucket,
      failBucket,
      thresholds: { pass: passThreshold, fail: failThreshold },
      pageResults,
      discoveryWarnings,
    },
  };
}

registerCheck({
  id: 'page-size-markdown',
  category: 'page-size',
  description: 'Character count of page when served as markdown',
  dependsOn: [['markdown-url-support', 'content-negotiation']],
  run: check,
});
