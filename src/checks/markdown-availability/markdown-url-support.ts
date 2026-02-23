import { registerCheck } from '../registry.js';
import { extractMarkdownLinks } from '../llms-txt/llms-txt-valid.js';
import { looksLikeMarkdown } from '../../helpers/detect-markdown.js';
import type { CheckContext, CheckResult, DiscoveredFile } from '../../types.js';

interface PageResult {
  url: string;
  mdUrl: string;
  supported: boolean;
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

/**
 * Generate candidate .md URLs for a page URL.
 * If the URL already ends in .md, return it as-is.
 * Otherwise try both `/docs/guide.md` and `/docs/guide/index.md`.
 */
function toMdUrls(url: string): string[] {
  const parsed = new URL(url);

  // URL already points to a .md file — use it directly
  if (parsed.pathname.endsWith('.md')) {
    return [url];
  }

  const pathname = parsed.pathname.replace(/\/$/, '') || '';
  const candidates: string[] = [];

  // /docs/guide.md
  const directMd = new URL(parsed.toString());
  directMd.pathname = pathname + '.md';
  candidates.push(directMd.toString());

  // /docs/guide/index.md
  const indexMd = new URL(parsed.toString());
  indexMd.pathname = pathname + '/index.md';
  candidates.push(indexMd.toString());

  return candidates;
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'markdown-url-support';
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
        const candidates = toMdUrls(url);
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
          } catch {
            // Try next candidate
          }
        }
        return { url, mdUrl: candidates[0], supported: false, status: 0 };
      }),
    );
    results.push(...batchResults);
  }

  const mdSupported = results.filter((r) => r.supported).length;
  const mdUnsupported = results.length - mdSupported;
  const supportRate = Math.round((mdSupported / results.length) * 100);

  const details: Record<string, unknown> = {
    totalPages,
    testedPages: results.length,
    sampled: wasSampled,
    mdSupported,
    mdUnsupported,
    supportRate,
    pageResults: results,
  };

  if (supportRate >= 90) {
    return {
      id,
      category,
      status: 'pass',
      message: `${mdSupported}/${results.length} pages support .md URLs (${supportRate}%)`,
      details,
    };
  }

  if (mdSupported > 0) {
    return {
      id,
      category,
      status: 'warn',
      message: `${mdSupported}/${results.length} pages support .md URLs (${supportRate}%); inconsistent support`,
      details,
    };
  }

  return {
    id,
    category,
    status: 'fail',
    message: `No pages support .md URLs (0/${results.length} tested)`,
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
