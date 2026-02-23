import { registerCheck } from '../registry.js';
import { LINK_RESOLVE_THRESHOLD } from '../../constants.js';
import { extractMarkdownLinks } from './llms-txt-valid.js';
import type { CheckContext, CheckResult, DiscoveredFile } from '../../types.js';

interface LinkCheckResult {
  url: string;
  status: number;
  ok: boolean;
  error?: string;
}

async function checkLlmsTxtLinksResolve(ctx: CheckContext): Promise<CheckResult> {
  const existsResult = ctx.previousResults.get('llms-txt-exists');
  const discovered = (existsResult?.details?.discoveredFiles ?? []) as DiscoveredFile[];

  if (discovered.length === 0) {
    return {
      id: 'llms-txt-links-resolve',
      category: 'llms-txt',
      status: 'skip',
      message: 'No llms.txt files to check links for',
      dependsOn: ['llms-txt-exists'],
    };
  }

  // Collect all unique links across all discovered files
  const allLinks = new Map<string, string>(); // url -> source file
  for (const file of discovered) {
    const links = extractMarkdownLinks(file.content);
    for (const link of links) {
      if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
        allLinks.set(link.url, file.url);
      }
    }
  }

  if (allLinks.size === 0) {
    return {
      id: 'llms-txt-links-resolve',
      category: 'llms-txt',
      status: 'skip',
      message: 'No HTTP(S) links found in llms.txt',
    };
  }

  // Sample links if there are too many
  let linksToTest = Array.from(allLinks.keys());
  const totalLinks = linksToTest.length;
  const wasSampled = totalLinks > ctx.options.maxLinksToTest;
  if (wasSampled) {
    // Shuffle and take a sample
    for (let i = linksToTest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [linksToTest[i], linksToTest[j]] = [linksToTest[j], linksToTest[i]];
    }
    linksToTest = linksToTest.slice(0, ctx.options.maxLinksToTest);
  }

  // Check links with bounded concurrency
  const results: LinkCheckResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < linksToTest.length; i += concurrency) {
    const batch = linksToTest.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<LinkCheckResult> => {
        try {
          const response = await ctx.http.fetch(url, { method: 'HEAD' });
          // Some servers don't support HEAD; fall back to GET
          if (response.status === 405) {
            const getResponse = await ctx.http.fetch(url);
            return { url, status: getResponse.status, ok: getResponse.ok };
          }
          return { url, status: response.status, ok: response.ok };
        } catch (err) {
          return {
            url,
            status: 0,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...batchResults);
  }

  const resolved = results.filter((r) => r.ok).length;
  const broken = results.filter((r) => !r.ok);
  const resolveRate = resolved / results.length;
  const fetchErrors = results.filter((r) => r.error).length;
  const rateLimited = results.filter((r) => r.status === 429).length;

  const linkLabel = wasSampled ? 'sampled links' : 'links';
  const suffix =
    (fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : '') +
    (rateLimited > 0 ? `; ${rateLimited} rate-limited (HTTP 429)` : '');

  const details: Record<string, unknown> = {
    totalLinks,
    testedLinks: results.length,
    sampled: wasSampled,
    resolved,
    broken: broken.map((b) => ({ url: b.url, status: b.status, error: b.error })),
    resolveRate: Math.round(resolveRate * 100),
    fetchErrors,
    rateLimited,
  };

  if (resolveRate === 1) {
    return {
      id: 'llms-txt-links-resolve',
      category: 'llms-txt',
      status: 'pass',
      message: `All ${results.length} tested ${linkLabel} resolve (${totalLinks} total links)${suffix}`,
      details,
    };
  }

  if (resolveRate > LINK_RESOLVE_THRESHOLD) {
    return {
      id: 'llms-txt-links-resolve',
      category: 'llms-txt',
      status: 'warn',
      message: `${resolved}/${results.length} ${linkLabel} resolve (${Math.round(resolveRate * 100)}%); ${broken.length} broken${suffix}`,
      details,
    };
  }

  return {
    id: 'llms-txt-links-resolve',
    category: 'llms-txt',
    status: 'fail',
    message: `Only ${resolved}/${results.length} ${linkLabel} resolve (${Math.round(resolveRate * 100)}%); ${broken.length} broken${suffix}`,
    details,
  };
}

registerCheck({
  id: 'llms-txt-links-resolve',
  category: 'llms-txt',
  description: 'Whether the URLs listed in llms.txt actually resolve',
  dependsOn: ['llms-txt-exists'],
  run: checkLlmsTxtLinksResolve,
});
