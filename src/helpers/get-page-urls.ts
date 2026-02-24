import { extractMarkdownLinks } from '../checks/llms-txt/llms-txt-valid.js';
import { MAX_SITEMAP_URLS } from '../constants.js';
import type { CheckContext, DiscoveredFile } from '../types.js';

/**
 * Extract `<loc>` URLs from a sitemap XML string.
 * Also returns any `<sitemap><loc>` entries from sitemap index files.
 */
export function parseSitemapUrls(xml: string): { urls: string[]; sitemapIndexUrls: string[] } {
  const urls: string[] = [];
  const sitemapIndexUrls: string[] = [];

  // Detect sitemap index: contains <sitemap> elements
  const isSitemapIndex = /<sitemap[\s>]/i.test(xml);

  if (isSitemapIndex) {
    // Extract <loc> inside <sitemap> blocks
    const sitemapBlockRegex = /<sitemap[\s>][\s\S]*?<\/sitemap>/gi;
    let block;
    while ((block = sitemapBlockRegex.exec(xml)) !== null) {
      const locMatch = /<loc>\s*(.*?)\s*<\/loc>/i.exec(block[0]);
      if (locMatch) {
        sitemapIndexUrls.push(locMatch[1]);
      }
    }
  } else {
    // Regular sitemap: extract all <loc> entries
    const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      urls.push(match[1]);
    }
  }

  return { urls, sitemapIndexUrls };
}

function getUrlsFromCachedLlmsTxt(ctx: CheckContext): string[] {
  const existsResult = ctx.previousResults.get('llms-txt-exists');
  const discovered = (existsResult?.details?.discoveredFiles ?? []) as DiscoveredFile[];

  return extractLinksFromLlmsTxtFiles(discovered);
}

function extractLinksFromLlmsTxtFiles(files: DiscoveredFile[]): string[] {
  const urls = new Set<string>();
  for (const file of files) {
    const links = extractMarkdownLinks(file.content);
    for (const link of links) {
      if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
        urls.add(link.url);
      }
    }
  }
  return Array.from(urls);
}

/**
 * Directly fetch llms.txt candidate URLs and extract links.
 * Used when `llms-txt-exists` hasn't run (e.g. standalone check mode).
 */
async function fetchLlmsTxtUrls(ctx: CheckContext): Promise<string[]> {
  const candidates = new Set<string>();
  candidates.add(`${ctx.baseUrl}/llms.txt`);
  candidates.add(`${ctx.origin}/llms.txt`);
  candidates.add(`${ctx.origin}/docs/llms.txt`);

  const discovered: DiscoveredFile[] = [];
  for (const url of candidates) {
    try {
      const response = await ctx.http.fetch(url);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/')) continue;
      const content = await response.text();
      const trimmed = content.trimStart().toLowerCase();
      if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) continue;
      if (content.trim().length === 0) continue;
      discovered.push({
        url,
        content,
        status: response.status,
        redirected: response.redirected,
      });
    } catch {
      // Skip failed fetches
    }
  }

  return extractLinksFromLlmsTxtFiles(discovered);
}

/**
 * Parse `Sitemap:` directives from a robots.txt body.
 * Returns an array of sitemap URLs found.
 */
export function parseSitemapDirectives(robotsTxt: string): string[] {
  const urls: string[] = [];
  for (const line of robotsTxt.split('\n')) {
    const match = /^\s*Sitemap:\s*(\S+)/i.exec(line);
    if (match) {
      urls.push(match[1]);
    }
  }
  return urls;
}

/**
 * Discover sitemap URLs by checking robots.txt first, then falling back to /sitemap.xml.
 */
async function discoverSitemapUrls(ctx: CheckContext): Promise<string[]> {
  // Try robots.txt for Sitemap directives
  try {
    const robotsResponse = await ctx.http.fetch(`${ctx.origin}/robots.txt`);
    if (robotsResponse.ok) {
      const body = await robotsResponse.text();
      const directives = parseSitemapDirectives(body);
      if (directives.length > 0) return directives;
    }
  } catch {
    // robots.txt fetch failed; fall through
  }

  // Default to /sitemap.xml
  return [`${ctx.origin}/sitemap.xml`];
}

export interface PageUrlResult {
  urls: string[];
  warnings: string[];
}

function isGzipped(url: string): boolean {
  return /\.gz($|\?)/i.test(url);
}

async function fetchSitemap(
  ctx: CheckContext,
  sitemapUrl: string,
  warnings: string[],
): Promise<{ urls: string[]; sitemapIndexUrls: string[] }> {
  if (isGzipped(sitemapUrl)) {
    warnings.push(`Skipped gzipped sitemap (not supported): ${sitemapUrl}`);
    return { urls: [], sitemapIndexUrls: [] };
  }

  try {
    const response = await ctx.http.fetch(sitemapUrl);
    if (!response.ok) return { urls: [], sitemapIndexUrls: [] };
    const xml = await response.text();
    return parseSitemapUrls(xml);
  } catch {
    return { urls: [], sitemapIndexUrls: [] };
  }
}

async function getUrlsFromSitemap(ctx: CheckContext, warnings: string[]): Promise<string[]> {
  const sitemapUrls = await discoverSitemapUrls(ctx);
  const urls: string[] = [];

  for (const sitemapUrl of sitemapUrls) {
    if (urls.length >= MAX_SITEMAP_URLS) break;

    const parsed = await fetchSitemap(ctx, sitemapUrl, warnings);

    // Add direct URLs (filtered to same origin)
    for (const url of parsed.urls) {
      if (urls.length >= MAX_SITEMAP_URLS) break;
      try {
        const u = new URL(url);
        if (u.origin === ctx.origin) {
          urls.push(url);
        }
      } catch {
        // Skip malformed URLs
      }
    }

    // Follow one level of sitemap index
    if (parsed.sitemapIndexUrls.length > 0 && urls.length < MAX_SITEMAP_URLS) {
      for (const subSitemapUrl of parsed.sitemapIndexUrls) {
        if (urls.length >= MAX_SITEMAP_URLS) break;

        const subParsed = await fetchSitemap(ctx, subSitemapUrl, warnings);

        for (const url of subParsed.urls) {
          if (urls.length >= MAX_SITEMAP_URLS) break;
          try {
            const u = new URL(url);
            if (u.origin === ctx.origin) {
              urls.push(url);
            }
          } catch {
            // Skip malformed URLs
          }
        }
      }
    }
  }

  return urls;
}

/**
 * Discover page URLs from llms.txt links, sitemap, or fall back to baseUrl.
 *
 * Priority:
 * 1. llms.txt links (from previous check results)
 * 2. Sitemap URLs (robots.txt Sitemap directives, then /sitemap.xml fallback)
 * 3. baseUrl fallback
 */
export async function getPageUrls(ctx: CheckContext): Promise<PageUrlResult> {
  const warnings: string[] = [];

  // 1. Try llms.txt links from cached results (if llms-txt-exists ran)
  const cachedUrls = getUrlsFromCachedLlmsTxt(ctx);
  if (cachedUrls.length > 0) return { urls: cachedUrls, warnings };

  // 2. Try fetching llms.txt directly (standalone mode, llms-txt-exists didn't run)
  if (!ctx.previousResults.has('llms-txt-exists')) {
    const fetchedUrls = await fetchLlmsTxtUrls(ctx);
    if (fetchedUrls.length > 0) return { urls: fetchedUrls, warnings };
  }

  // 3. Try sitemap
  const sitemapUrls = await getUrlsFromSitemap(ctx, warnings);
  if (sitemapUrls.length > 0) return { urls: sitemapUrls, warnings };

  // 4. Fallback
  return { urls: [ctx.baseUrl], warnings };
}

export interface SampledPages {
  urls: string[];
  totalPages: number;
  sampled: boolean;
  warnings: string[];
}

/**
 * Discover page URLs and sample down to maxLinksToTest if needed.
 * Consolidates the discover+shuffle+sample pattern used by multiple checks.
 *
 * The result is cached on ctx so that all checks within a single run
 * share the same sampled page list, avoiding inconsistent results.
 */
export async function discoverAndSamplePages(ctx: CheckContext): Promise<SampledPages> {
  if (ctx._sampledPages) return ctx._sampledPages;

  const discovery = await getPageUrls(ctx);
  let urls = discovery.urls;
  const totalPages = urls.length;

  const sampled = totalPages > ctx.options.maxLinksToTest;
  if (sampled) {
    for (let i = urls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [urls[i], urls[j]] = [urls[j], urls[i]];
    }
    urls = urls.slice(0, ctx.options.maxLinksToTest);
  }

  ctx._sampledPages = { urls, totalPages, sampled, warnings: discovery.warnings };
  return ctx._sampledPages;
}
