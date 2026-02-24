import { looksLikeMarkdown } from './detect-markdown.js';
import { discoverAndSamplePages } from './get-page-urls.js';
import { toMdUrls } from './to-md-urls.js';
import type { CheckContext, DiscoveredFile } from '../types.js';

export interface MarkdownPage {
  url: string;
  content: string;
  source: string;
}

export type MarkdownContentResult =
  | { mode: 'cached'; pages: MarkdownPage[]; depPassed: boolean }
  | { mode: 'standalone'; pages: MarkdownPage[] };

/**
 * Get markdown content for analysis, either from dependency cache or by fetching directly.
 *
 * When markdown-url-support or content-negotiation have already run, reads from
 * ctx.pageCache (fast). Otherwise, discovers pages and probes for markdown itself.
 * Always includes llms.txt content when available.
 */
export async function getMarkdownContent(ctx: CheckContext): Promise<MarkdownContentResult> {
  const mdUrlResult = ctx.previousResults.get('markdown-url-support');
  const cnResult = ctx.previousResults.get('content-negotiation');
  const depRan = mdUrlResult || cnResult;

  const llmsTxtPages = collectLlmsTxtContent(ctx);

  if (depRan) {
    const depPassed =
      (mdUrlResult && (mdUrlResult.status === 'pass' || mdUrlResult.status === 'warn')) ||
      (cnResult && (cnResult.status === 'pass' || cnResult.status === 'warn'));

    const cachedPages = collectCachedPages(ctx);
    return { mode: 'cached', pages: [...cachedPages, ...llmsTxtPages], depPassed: !!depPassed };
  }

  // Standalone mode: fetch markdown ourselves
  const fetchedPages = await fetchMarkdownPages(ctx);
  return { mode: 'standalone', pages: [...fetchedPages, ...llmsTxtPages] };
}

function collectCachedPages(ctx: CheckContext): MarkdownPage[] {
  const pages: MarkdownPage[] = [];
  for (const [url, cached] of ctx.pageCache) {
    if (cached.markdown?.content) {
      pages.push({ url, content: cached.markdown.content, source: cached.markdown.source });
    }
  }
  return pages;
}

function collectLlmsTxtContent(ctx: CheckContext): MarkdownPage[] {
  const existsResult = ctx.previousResults.get('llms-txt-exists');
  const discovered = (existsResult?.details?.discoveredFiles ?? []) as DiscoveredFile[];
  const pages: MarkdownPage[] = [];
  for (const file of discovered) {
    if (file.content) {
      pages.push({ url: file.url, content: file.content, source: 'llms-txt' });
    }
  }
  return pages;
}

async function fetchMarkdownPages(ctx: CheckContext): Promise<MarkdownPage[]> {
  const pages: MarkdownPage[] = [];
  const { urls: pageUrls } = await discoverAndSamplePages(ctx);
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<MarkdownPage | null> => {
        // Try .md URL candidates
        const candidates = toMdUrls(url);
        for (const candidateUrl of candidates) {
          try {
            const response = await ctx.http.fetch(candidateUrl);
            if (!response.ok) continue;
            const body = await response.text();
            if (looksLikeMarkdown(body)) {
              return { url: candidateUrl, content: body, source: 'standalone-md-url' };
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
              return { url, content: body, source: 'standalone-content-negotiation' };
            }
          }
        } catch {
          // No markdown available for this page
        }

        return null;
      }),
    );

    for (const r of batchResults) {
      if (r) pages.push(r);
    }
  }

  return pages;
}
