import { registerCheck } from '../registry.js';
import { extractMarkdownLinks } from '../llms-txt/llms-txt-valid.js';
import { looksLikeMarkdown } from '../../helpers/detect-markdown.js';
import type { CheckContext, CheckResult, DiscoveredFile } from '../../types.js';

type Classification = 'markdown-with-correct-type' | 'markdown-with-wrong-type' | 'html';

interface PageResult {
  url: string;
  classification: Classification;
  contentType: string;
  status: number;
}

function getPageUrls(ctx: CheckContext): string[] {
  const existsResult = ctx.previousResults.get('llms-txt-exists');
  const discovered = (existsResult?.details?.discoveredFiles ?? []) as DiscoveredFile[];

  const urls = new Set<string>();
  for (const file of discovered) {
    const links = extractMarkdownLinks(file.content);
    for (const link of links) {
      if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
        urls.add(link.url);
      }
    }
  }

  if (urls.size === 0) {
    urls.add(ctx.baseUrl);
  }

  return Array.from(urls);
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'content-negotiation';
  const category = 'markdown-availability';

  let pageUrls = getPageUrls(ctx);
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
        } catch {
          return { url, classification: 'html', contentType: '', status: 0 };
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

  const details: Record<string, unknown> = {
    totalPages,
    testedPages: results.length,
    sampled: wasSampled,
    markdownWithCorrectType,
    markdownWithWrongType,
    htmlOnly,
    negotiationRate,
    pageResults: results,
  };

  if (negotiationRate >= 90) {
    return {
      id,
      category,
      status: 'pass',
      message: `${markdownWithCorrectType}/${results.length} pages support content negotiation (${negotiationRate}%)`,
      details,
    };
  }

  if (markdownWithCorrectType > 0 || markdownWithWrongType > 0) {
    return {
      id,
      category,
      status: 'warn',
      message: `Content negotiation partially supported: ${markdownWithCorrectType} correct type, ${markdownWithWrongType} wrong type, ${htmlOnly} HTML only`,
      details,
    };
  }

  return {
    id,
    category,
    status: 'fail',
    message: `Server ignores Accept: text/markdown header (0/${results.length} pages return markdown)`,
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
