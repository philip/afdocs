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

function getUrlsFromLlmsTxt(ctx: CheckContext): string[] {
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

  return Array.from(urls);
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

  // 1. Try llms.txt links
  const llmsUrls = getUrlsFromLlmsTxt(ctx);
  if (llmsUrls.length > 0) return { urls: llmsUrls, warnings };

  // 2. Try sitemap
  const sitemapUrls = await getUrlsFromSitemap(ctx, warnings);
  if (sitemapUrls.length > 0) return { urls: sitemapUrls, warnings };

  // 3. Fallback
  return { urls: [ctx.baseUrl], warnings };
}
