import { registerCheck } from '../registry.js';
import { looksLikeMarkdown } from '../../helpers/detect-markdown.js';
import { getPageUrls } from '../../helpers/get-page-urls.js';
import type { CheckContext, CheckResult } from '../../types.js';

type Classification = 'markdown-with-correct-type' | 'markdown-with-wrong-type' | 'html';

interface PageResult {
  url: string;
  classification: Classification;
  contentType: string;
  status: number;
  error?: string;
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'content-negotiation';
  const category = 'markdown-availability';

  const discovery = await getPageUrls(ctx);
  let pageUrls = discovery.urls;
  const totalPages = pageUrls.length;

  // Sample if too many
  const wasSampled = totalPages > ctx.options.maxLinksToTest;
  if (wasSampled) {
    for (let i = pageUrls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pageUrls[i], pageUrls[j]] = [pageUrls[j], pageUrls[i]];
    }
    pageUrls = pageUrls.slice(0, ctx.options.maxLinksToTest);
  }

  const results: PageResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<PageResult> => {
        try {
          const response = await ctx.http.fetch(url, {
            headers: { Accept: 'text/markdown' },
          });
          const body = await response.text();
          const contentType = response.headers.get('content-type') ?? '';
          const isMarkdownType = contentType.includes('text/markdown');
          const isMarkdownBody = looksLikeMarkdown(body);

          let classification: Classification;
          if (isMarkdownType && isMarkdownBody) {
            classification = 'markdown-with-correct-type';
            // Cache the markdown content (only if not already cached by md-url check)
            if (!ctx.pageCache.has(url)) {
              ctx.pageCache.set(url, {
                url,
                markdown: { content: body, source: 'content-negotiation' },
              });
            }
          } else if (isMarkdownBody) {
            classification = 'markdown-with-wrong-type';
            if (!ctx.pageCache.has(url)) {
              ctx.pageCache.set(url, {
                url,
                markdown: { content: body, source: 'content-negotiation' },
              });
            }
          } else {
            classification = 'html';
          }

          return { url, classification, contentType, status: response.status };
        } catch (err) {
          return {
            url,
            classification: 'html',
            contentType: '',
            status: 0,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...batchResults);
  }

  const markdownWithCorrectType = results.filter(
    (r) => r.classification === 'markdown-with-correct-type',
  ).length;
  const markdownWithWrongType = results.filter(
    (r) => r.classification === 'markdown-with-wrong-type',
  ).length;
  const htmlOnly = results.filter((r) => r.classification === 'html').length;
  const negotiationRate = Math.round((markdownWithCorrectType / results.length) * 100);
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
    markdownWithCorrectType,
    markdownWithWrongType,
    htmlOnly,
    negotiationRate,
    fetchErrors,
    rateLimited,
    pageResults: results,
    discoveryWarnings: discovery.warnings,
  };

  if (negotiationRate >= 90) {
    return {
      id,
      category,
      status: 'pass',
      message: `${markdownWithCorrectType}/${results.length} ${pageLabel} support content negotiation (${negotiationRate}%)${suffix}`,
      details,
    };
  }

  if (markdownWithCorrectType > 0 || markdownWithWrongType > 0) {
    return {
      id,
      category,
      status: 'warn',
      message: `Content negotiation partially supported: ${markdownWithCorrectType} correct type, ${markdownWithWrongType} wrong type, ${htmlOnly} HTML only${suffix}`,
      details,
    };
  }

  return {
    id,
    category,
    status: 'fail',
    message: `Server ignores Accept: text/markdown header (0/${results.length} ${pageLabel} return markdown)${suffix}`,
    details,
  };
}

registerCheck({
  id: 'content-negotiation',
  category: 'markdown-availability',
  description: 'Whether the server responds to Accept: text/markdown',
  dependsOn: [],
  run: check,
});
