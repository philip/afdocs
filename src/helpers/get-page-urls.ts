import { extractMarkdownLinks } from '../checks/content-discoverability/llms-txt-valid.js';
import { MAX_SITEMAP_URLS } from '../constants.js';
import { isNonPageUrl } from './to-md-urls.js';
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

export async function getUrlsFromCachedLlmsTxt(ctx: CheckContext): Promise<string[]> {
  const existsResult = ctx.previousResults.get('llms-txt-exists');
  const discovered = (existsResult?.details?.discoveredFiles ?? []) as DiscoveredFile[];

  const urls = extractLinksFromLlmsTxtFiles(discovered);
  return walkAggregateLinks(ctx, urls);
}

function extractLinksFromLlmsTxtFiles(files: DiscoveredFile[]): string[] {
  const urls = new Set<string>();
  for (const file of files) {
    const links = extractMarkdownLinks(file.content);
    for (const link of links) {
      if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
        urls.add(link.url);
      } else if (link.url.startsWith('/')) {
        // Resolve root-relative URLs against the source file's origin
        try {
          const base = new URL(file.url);
          urls.add(new URL(link.url, base.origin).toString());
        } catch {
          // Skip malformed URLs
        }
      }
    }
  }
  return Array.from(urls);
}

/**
 * Identify .txt links that are likely aggregate/index files (progressive
 * disclosure pattern) and walk them one level deep to find page URLs.
 *
 * A link is considered walkable when it ends in .txt and is on the same
 * origin as the site being tested. This covers both sub-product llms.txt
 * files (Cloudflare) and aggregate content files (Supabase).
 */
async function walkAggregateLinks(ctx: CheckContext, urls: string[]): Promise<string[]> {
  const pageUrls: string[] = [];
  const aggregateUrls: string[] = [];

  const siteOrigin = ctx.effectiveOrigin ?? ctx.origin;

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (/\.txt$/i.test(parsed.pathname)) {
        // .txt files are either aggregate indexes to walk (same origin)
        // or external resources to skip — never page URLs themselves
        if (parsed.origin === ctx.origin || parsed.origin === siteOrigin) {
          aggregateUrls.push(url);
        }
      } else if (parsed.origin === ctx.origin || parsed.origin === siteOrigin) {
        // Only include same-origin page URLs; cross-origin links are
        // external resources the site owner doesn't control.
        pageUrls.push(url);
      }
    } catch {
      pageUrls.push(url);
    }
  }

  if (aggregateUrls.length === 0) return pageUrls;

  // Fetch aggregate files and extract their links
  for (const aggUrl of aggregateUrls) {
    try {
      const response = await ctx.http.fetch(aggUrl);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/')) continue;
      const content = await response.text();
      const trimmed = content.trimStart().toLowerCase();
      if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) continue;
      if (content.trim().length === 0) continue;

      const subFile: DiscoveredFile = {
        url: aggUrl,
        content,
        status: response.status,
        redirected: response.redirected,
      };
      const subUrls = extractLinksFromLlmsTxtFiles([subFile]);

      for (const subUrl of subUrls) {
        // Only keep same-origin page URLs (skip further .txt nesting)
        try {
          const parsed = new URL(subUrl);
          if (
            (parsed.origin === ctx.origin || parsed.origin === siteOrigin) &&
            !isNonPageUrl(subUrl)
          ) {
            pageUrls.push(subUrl);
          }
        } catch {
          // Skip malformed URLs
        }
      }
    } catch {
      // Skip failed fetches
    }
  }

  return pageUrls;
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

  const urls = extractLinksFromLlmsTxtFiles(discovered);
  return walkAggregateLinks(ctx, urls);
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
async function discoverSitemapUrls(ctx: CheckContext, originOverride?: string): Promise<string[]> {
  // Try robots.txt for Sitemap directives at the original origin first
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

  // If there's an effective origin (cross-host redirect), try its robots.txt too
  if (originOverride && originOverride !== ctx.origin) {
    try {
      const robotsResponse = await ctx.http.fetch(`${originOverride}/robots.txt`);
      if (robotsResponse.ok) {
        const body = await robotsResponse.text();
        const directives = parseSitemapDirectives(body);
        if (directives.length > 0) return directives;
      }
    } catch {
      // fall through
    }
  }

  // Default to /sitemap.xml (prefer effective origin if available)
  return [`${originOverride ?? ctx.origin}/sitemap.xml`];
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

export async function getUrlsFromSitemap(
  ctx: CheckContext,
  warnings: string[],
  maxUrls: number = MAX_SITEMAP_URLS,
  originOverride?: string,
): Promise<string[]> {
  const sitemapUrls = await discoverSitemapUrls(ctx, originOverride);
  const urls: string[] = [];
  const matchOrigin = originOverride ?? ctx.origin;

  for (const sitemapUrl of sitemapUrls) {
    if (urls.length >= maxUrls) break;

    const parsed = await fetchSitemap(ctx, sitemapUrl, warnings);

    // Add direct URLs (filtered to same origin)
    for (const url of parsed.urls) {
      if (urls.length >= maxUrls) break;
      try {
        const u = new URL(url);
        if (u.origin === matchOrigin) {
          urls.push(url);
        }
      } catch {
        // Skip malformed URLs
      }
    }

    // Follow one level of sitemap index
    if (parsed.sitemapIndexUrls.length > 0 && urls.length < maxUrls) {
      for (const subSitemapUrl of parsed.sitemapIndexUrls) {
        if (urls.length >= maxUrls) break;

        const subParsed = await fetchSitemap(ctx, subSitemapUrl, warnings);

        for (const url of subParsed.urls) {
          if (urls.length >= maxUrls) break;
          try {
            const u = new URL(url);
            if (u.origin === matchOrigin) {
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
 * Get the base URL for path-prefix filtering, accounting for cross-host redirects.
 *
 * When a cross-host redirect is in play (e.g. example.com/docs → docs.example.com),
 * the original baseUrl path doesn't apply to the redirected host, so we return the
 * effectiveOrigin (a root URL) which makes path filtering a no-op.
 */
export function getPathFilterBase(ctx: CheckContext): string {
  return ctx.effectiveOrigin && ctx.effectiveOrigin !== ctx.origin
    ? ctx.effectiveOrigin
    : ctx.baseUrl;
}

/**
 * Filter URLs to those under the baseUrl's path prefix.
 *
 * When the input URL has a non-root path (e.g. `https://plaid.com/docs`),
 * only URLs whose pathname starts with that prefix are kept. This prevents
 * blog posts, marketing pages, and other non-docs content from polluting
 * the URL pool when llms.txt or sitemaps cover the entire domain.
 *
 * Root URLs (path is `/`) pass all same-origin URLs through unfiltered.
 */
export function filterByPathPrefix(urls: string[], baseUrl: string): string[] {
  const baseUrlPath = new URL(baseUrl).pathname.replace(/\/$/, '');
  if (!baseUrlPath || baseUrlPath === '') return urls;

  return urls.filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.pathname === baseUrlPath || parsed.pathname.startsWith(baseUrlPath + '/');
    } catch {
      return true; // keep malformed URLs rather than silently dropping them
    }
  });
}

/**
 * Discover page URLs from llms.txt links, sitemap, or fall back to baseUrl.
 *
 * Priority:
 * 1. llms.txt links (from previous check results)
 * 2. Sitemap URLs (robots.txt Sitemap directives, then /sitemap.xml fallback)
 * 3. baseUrl fallback
 *
 * All discovered URLs are filtered to the baseUrl's path prefix so that
 * docs at a subpath (e.g. `/docs`) don't include unrelated site content.
 */
export async function getPageUrls(ctx: CheckContext): Promise<PageUrlResult> {
  const warnings: string[] = [];

  const filterBase = getPathFilterBase(ctx);

  // 1. Try llms.txt links from cached results (if llms-txt-exists ran)
  const cachedUrls = await getUrlsFromCachedLlmsTxt(ctx);
  const scopedCachedUrls = filterByPathPrefix(cachedUrls, filterBase);
  if (scopedCachedUrls.length > 0) return { urls: scopedCachedUrls, warnings };

  // 2. Try fetching llms.txt directly (standalone mode, llms-txt-exists didn't run)
  if (!ctx.previousResults.has('llms-txt-exists')) {
    const fetchedUrls = await fetchLlmsTxtUrls(ctx);
    const scopedFetchedUrls = filterByPathPrefix(fetchedUrls, filterBase);
    if (scopedFetchedUrls.length > 0) return { urls: scopedFetchedUrls, warnings };
  }

  // 3. Try sitemap
  const sitemapUrls = await getUrlsFromSitemap(ctx, warnings);
  const scopedSitemapUrls = filterByPathPrefix(sitemapUrls, filterBase);
  if (scopedSitemapUrls.length > 0) return { urls: scopedSitemapUrls, warnings };

  // 4. Fallback
  return { urls: [ctx.baseUrl], warnings };
}

export interface SampledPages {
  urls: string[];
  totalPages: number;
  sampled: boolean;
  warnings: string[];
  /** When curated pages have tags, maps page URL to tag label. */
  urlTags?: Record<string, string>;
}

/**
 * Discover page URLs and sample down to maxLinksToTest if needed.
 * Consolidates the discover+shuffle+sample pattern used by multiple checks.
 *
 * The result is cached on ctx so that all checks within a single run
 * share the same sampled page list, avoiding inconsistent results.
 *
 * Sampling strategies:
 * - `random`: Fisher-Yates shuffle, then take the first maxLinksToTest. (Default.)
 * - `deterministic`: Sort URLs lexicographically, then pick every Nth URL
 *   so that the result is reproducible across runs (as long as the discovered
 *   URL set is stable).
 * - `none`: Skip discovery entirely; return only the baseUrl.
 */
export async function discoverAndSamplePages(ctx: CheckContext): Promise<SampledPages> {
  if (ctx._sampledPages) return ctx._sampledPages;

  const strategy = ctx.options.samplingStrategy;

  // "curated" uses explicitly listed pages from config or --urls.
  if (strategy === 'curated') {
    const entries = ctx._curatedPages;
    if (!entries || entries.length === 0) {
      ctx._sampledPages = {
        urls: [ctx.baseUrl],
        totalPages: 1,
        sampled: false,
        warnings: ['Curated strategy selected but no pages defined; falling back to base URL'],
      };
      return ctx._sampledPages;
    }

    const urls: string[] = [];
    const urlTags: Record<string, string> = {};
    for (const entry of entries) {
      if (typeof entry === 'string') {
        urls.push(entry);
      } else {
        urls.push(entry.url);
        if (entry.tag) {
          urlTags[entry.url] = entry.tag;
        }
      }
    }

    ctx._sampledPages = {
      urls,
      totalPages: urls.length,
      sampled: false,
      warnings: [],
      urlTags: Object.keys(urlTags).length > 0 ? urlTags : undefined,
    };
    return ctx._sampledPages;
  }

  // "none" skips discovery and uses only the URL the user provided.
  if (strategy === 'none') {
    ctx._sampledPages = {
      urls: [ctx.baseUrl],
      totalPages: 1,
      sampled: false,
      warnings: [],
    };
    return ctx._sampledPages;
  }

  const discovery = await getPageUrls(ctx);
  let urls = discovery.urls;
  const totalPages = urls.length;

  const sampled = totalPages > ctx.options.maxLinksToTest;
  if (sampled) {
    if (strategy === 'deterministic') {
      // Sort lexicographically for a stable ordering, then pick evenly-spaced URLs.
      urls.sort();
      const stride = urls.length / ctx.options.maxLinksToTest;
      const picked: string[] = [];
      for (let i = 0; i < ctx.options.maxLinksToTest; i++) {
        picked.push(urls[Math.floor(i * stride)]);
      }
      urls = picked;
    } else {
      // "random" — Fisher-Yates shuffle
      for (let i = urls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [urls[i], urls[j]] = [urls[j], urls[i]];
      }
      urls = urls.slice(0, ctx.options.maxLinksToTest);
    }
  }

  ctx._sampledPages = { urls, totalPages, sampled, warnings: discovery.warnings };
  return ctx._sampledPages;
}
