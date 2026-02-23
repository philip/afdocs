import { registerCheck } from '../registry.js';
import { looksLikeMarkdown } from '../../helpers/detect-markdown.js';
import { discoverAndSamplePages } from '../../helpers/get-page-urls.js';
import { toMdUrls } from '../../helpers/to-md-urls.js';
import type { CheckContext, CheckResult } from '../../types.js';

interface PageResult {
  url: string;
  mdUrl: string;
  supported: boolean;
  status: number;
  error?: string;
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'markdown-url-support';
  const category = 'markdown-availability';

  const {
    urls: pageUrls,
    totalPages,
    sampled: wasSampled,
    warnings,
  } = await discoverAndSamplePages(ctx);

  const results: PageResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<PageResult> => {
        const candidates = toMdUrls(url);
        let lastError: string | undefined;
        for (const mdUrl of candidates) {
          try {
            const response = await ctx.http.fetch(mdUrl);
            const body = await response.text();
            const contentType = response.headers.get('content-type') ?? '';
            const isMarkdownType = contentType.includes('text/markdown');
            const isMarkdownBody = looksLikeMarkdown(body);
            const supported = response.ok && (isMarkdownType || isMarkdownBody);

            if (supported) {
              ctx.pageCache.set(url, {
                url,
                markdown: { content: body, source: 'md-url' },
              });
              return { url, mdUrl, supported: true, status: response.status };
            }
            lastError = undefined; // Got a response, not a fetch error
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
          }
        }
        return { url, mdUrl: candidates[0], supported: false, status: 0, error: lastError };
      }),
    );
    results.push(...batchResults);
  }

  const mdSupported = results.filter((r) => r.supported).length;
  const mdUnsupported = results.length - mdSupported;
  const supportRate = Math.round((mdSupported / results.length) * 100);
  const fetchErrors = results.filter((r) => r.error).length;
  const rateLimited = results.filter((r) => r.status === 429).length;

  const pageLabel = wasSampled ? 'sampled pages' : 'pages';
  const suffix =
    (fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : '') +
    (rateLimited > 0 ? `; ${rateLimited} rate-limited (HTTP 429)` : '');

  const details: Record<string, unknown> = {
    totalPages,
    testedPages: results.length,
    sampled: wasSampled,
    mdSupported,
    mdUnsupported,
    supportRate,
    fetchErrors,
    rateLimited,
    pageResults: results,
    discoveryWarnings: warnings,
  };

  if (supportRate >= 90) {
    return {
      id,
      category,
      status: 'pass',
      message: `${mdSupported}/${results.length} ${pageLabel} support .md URLs (${supportRate}%)${suffix}`,
      details,
    };
  }

  if (mdSupported > 0) {
    return {
      id,
      category,
      status: 'warn',
      message: `${mdSupported}/${results.length} ${pageLabel} support .md URLs (${supportRate}%); inconsistent support${suffix}`,
      details,
    };
  }

  return {
    id,
    category,
    status: 'fail',
    message: `No ${pageLabel} support .md URLs (0/${results.length} tested)${suffix}`,
    details,
  };
}

registerCheck({
  id: 'markdown-url-support',
  category: 'markdown-availability',
  description: 'Whether appending .md to page URLs returns valid markdown',
  dependsOn: [],
  run: check,
});
