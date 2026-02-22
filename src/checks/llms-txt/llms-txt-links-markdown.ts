import { registerCheck } from '../registry.js';
import { extractMarkdownLinks } from './llms-txt-valid.js';
import type { CheckContext, CheckResult, DiscoveredFile } from '../../types.js';

interface LinkMarkdownResult {
  url: string;
  hasMarkdownExtension: boolean;
  servesMarkdown: boolean;
  mdVariantAvailable?: boolean;
}

function hasMarkdownExtension(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname.endsWith('.md') || pathname.endsWith('.mdx');
  } catch {
    return false;
  }
}

async function checkLlmsTxtLinksMarkdown(ctx: CheckContext): Promise<CheckResult> {
  const existsResult = ctx.previousResults.get('llms-txt-exists');
  const discovered = (existsResult?.details?.discoveredFiles ?? []) as DiscoveredFile[];

  if (discovered.length === 0) {
    return {
      id: 'llms-txt-links-markdown',
      category: 'llms-txt',
      status: 'skip',
      message: 'No llms.txt files to check links for',
      dependsOn: ['llms-txt-exists'],
    };
  }

  // Collect unique links
  const allLinks = new Set<string>();
  for (const file of discovered) {
    const links = extractMarkdownLinks(file.content);
    for (const link of links) {
      if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
        allLinks.add(link.url);
      }
    }
  }

  if (allLinks.size === 0) {
    return {
      id: 'llms-txt-links-markdown',
      category: 'llms-txt',
      status: 'skip',
      message: 'No HTTP(S) links found in llms.txt',
    };
  }

  // Sample if too many
  let linksToTest = Array.from(allLinks);
  const totalLinks = linksToTest.length;
  if (totalLinks > ctx.options.maxLinksToTest) {
    for (let i = linksToTest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [linksToTest[i], linksToTest[j]] = [linksToTest[j], linksToTest[i]];
    }
    linksToTest = linksToTest.slice(0, ctx.options.maxLinksToTest);
  }

  const results: LinkMarkdownResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < linksToTest.length; i += concurrency) {
    const batch = linksToTest.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<LinkMarkdownResult> => {
        const hasMdExt = hasMarkdownExtension(url);

        if (hasMdExt) {
          return { url, hasMarkdownExtension: true, servesMarkdown: true };
        }

        // Check if the URL serves markdown via content-type
        try {
          const response = await ctx.http.fetch(url, {
            method: 'HEAD',
            headers: { Accept: 'text/markdown' },
          });
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('text/markdown')) {
            return { url, hasMarkdownExtension: false, servesMarkdown: true };
          }

          // Try .md variant
          const mdUrl = url.replace(/\/?$/, '.md');
          try {
            const mdResponse = await ctx.http.fetch(mdUrl, { method: 'HEAD' });
            if (mdResponse.ok) {
              return {
                url,
                hasMarkdownExtension: false,
                servesMarkdown: false,
                mdVariantAvailable: true,
              };
            }
          } catch {
            // .md variant not available
          }

          return {
            url,
            hasMarkdownExtension: false,
            servesMarkdown: false,
            mdVariantAvailable: false,
          };
        } catch {
          return { url, hasMarkdownExtension: false, servesMarkdown: false };
        }
      }),
    );
    results.push(...batchResults);
  }

  const markdownLinks = results.filter((r) => r.hasMarkdownExtension || r.servesMarkdown).length;
  const mdVariantsAvailable = results.filter((r) => r.mdVariantAvailable).length;
  const markdownRate = results.length > 0 ? markdownLinks / results.length : 0;

  const details: Record<string, unknown> = {
    totalLinks,
    testedLinks: results.length,
    markdownLinks,
    htmlLinks: results.length - markdownLinks,
    mdVariantsAvailable,
    markdownRate: Math.round(markdownRate * 100),
  };

  if (markdownRate >= 0.9) {
    return {
      id: 'llms-txt-links-markdown',
      category: 'llms-txt',
      status: 'pass',
      message: `${markdownLinks}/${results.length} links point to markdown content (${Math.round(markdownRate * 100)}%)`,
      details,
    };
  }

  if (mdVariantsAvailable > 0) {
    return {
      id: 'llms-txt-links-markdown',
      category: 'llms-txt',
      status: 'warn',
      message: `Links point to HTML, but ${mdVariantsAvailable} have .md variants available`,
      details,
    };
  }

  return {
    id: 'llms-txt-links-markdown',
    category: 'llms-txt',
    status: 'fail',
    message: 'Links point to HTML and no markdown alternatives detected',
    details,
  };
}

registerCheck({
  id: 'llms-txt-links-markdown',
  category: 'llms-txt',
  description: 'Whether the URLs in llms.txt point to markdown content',
  dependsOn: ['llms-txt-exists'],
  run: checkLlmsTxtLinksMarkdown,
});
