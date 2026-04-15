import { registerCheck } from '../registry.js';
import { discoverAndSamplePages } from '../../helpers/get-page-urls.js';
import { toHtmlUrl } from '../../helpers/to-md-urls.js';
import type { CheckContext, CheckResult } from '../../types.js';

interface DirectiveResult {
  url: string;
  found: boolean;
  /** Where the directive was found: 'html', 'markdown', or undefined if not found. */
  source?: 'html' | 'markdown';
  /** Character position of the directive in the content, if found. */
  position?: number;
  /** Position as a percentage of total content length. */
  positionPercent?: number;
  /** The matched directive text (trimmed for display). */
  matchText?: string;
  error?: string;
}

/**
 * Patterns that indicate an agent-facing directive pointing to llms.txt.
 *
 * HTML pattern matches:
 * - Links whose href contains "llms.txt"
 * - Text mentioning "llms.txt" in prose
 *
 * Markdown pattern matches:
 * - Markdown links to llms.txt (e.g., [index](/llms.txt))
 * - Plain text mentioning "llms.txt"
 */
const HTML_DIRECTIVE_PATTERN =
  /(?:<a\s[^>]*href\s*=\s*["'][^"']*llms\.txt[^"']*["'][^>]*>[\s\S]*?<\/a>|llms\.txt)/gi;

const MARKDOWN_DIRECTIVE_PATTERN = /llms\.txt/gi;

/** Percentage threshold: directive in the first 10% is "near the top". */
const TOP_THRESHOLD = 0.1;
/** Percentage threshold: directive past 50% is "buried deep". */
const DEEP_THRESHOLD = 0.5;

/**
 * Extract the HTML body content (between <body> and </body>), or fall
 * back to the full HTML if no body tags are found.
 */
function extractBody(html: string): { body: string; offset: number } {
  const openMatch = /<body[\s>]/i.exec(html);
  if (!openMatch) return { body: html, offset: 0 };

  const bodyStart = html.indexOf('>', openMatch.index + openMatch[0].length - 1) + 1;
  const closeMatch = /<\/body\s*>/i.exec(html.slice(bodyStart));
  const bodyEnd = closeMatch ? bodyStart + closeMatch.index : html.length;

  return { body: html.slice(bodyStart, bodyEnd), offset: bodyStart };
}

function searchContent(
  content: string,
  pattern: RegExp,
): { position: number; matchText: string } | null {
  const match = pattern.exec(content);
  pattern.lastIndex = 0;
  if (!match) return null;
  return { position: match.index, matchText: match[0].slice(0, 200) };
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'llms-txt-directive';
  const category = 'content-discoverability';

  const { urls: pageUrls, totalPages, sampled, warnings } = await discoverAndSamplePages(ctx);

  const results: DirectiveResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<DirectiveResult> => {
        try {
          // Try the HTML version of the page first
          const htmlUrl = toHtmlUrl(url);
          const response = await ctx.http.fetch(htmlUrl);
          if (!response.ok) {
            return { url: htmlUrl, found: false, error: `HTTP ${response.status}` };
          }

          const contentType = response.headers.get('content-type') ?? '';
          const text = await response.text();

          // Determine if we got HTML or markdown
          const isHtml = contentType.includes('text/html') || text.trimStart().startsWith('<');

          if (isHtml) {
            const { body } = extractBody(text);
            const hit = searchContent(body, HTML_DIRECTIVE_PATTERN);
            if (hit) {
              const positionPercent = body.length > 0 ? hit.position / body.length : 0;
              return {
                url: htmlUrl,
                found: true,
                source: 'html',
                position: hit.position,
                positionPercent,
                matchText: hit.matchText,
              };
            }
          } else {
            // Got markdown content; search it directly
            const hit = searchContent(text, MARKDOWN_DIRECTIVE_PATTERN);
            if (hit) {
              const positionPercent = text.length > 0 ? hit.position / text.length : 0;
              return {
                url: htmlUrl,
                found: true,
                source: 'markdown',
                position: hit.position,
                positionPercent,
                matchText: hit.matchText,
              };
            }
          }

          // If the original URL was different (a .md URL), also check it
          if (url !== htmlUrl) {
            try {
              const mdResponse = await ctx.http.fetch(url);
              if (mdResponse.ok) {
                const mdText = await mdResponse.text();
                const hit = searchContent(mdText, MARKDOWN_DIRECTIVE_PATTERN);
                if (hit) {
                  const positionPercent = mdText.length > 0 ? hit.position / mdText.length : 0;
                  return {
                    url,
                    found: true,
                    source: 'markdown',
                    position: hit.position,
                    positionPercent,
                    matchText: hit.matchText,
                  };
                }
              }
            } catch {
              // Markdown fetch failed; that's fine, we already checked HTML
            }
          }

          return { url: htmlUrl, found: false };
        } catch (err) {
          return {
            url,
            found: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...batchResults);
  }

  const tested = results.filter((r) => !r.error);
  const fetchErrors = results.filter((r) => r.error).length;
  const found = results.filter((r) => r.found);
  const notFound = tested.filter((r) => !r.found);

  if (tested.length === 0) {
    return {
      id,
      category,
      status: 'fail',
      message: `Could not test any pages${fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : ''}`,
      details: {
        totalPages,
        testedPages: results.length,
        sampled,
        fetchErrors,
        pageResults: results,
        discoveryWarnings: warnings,
      },
    };
  }

  // Classify pages with directives by position
  const nearTop = found.filter((r) => (r.positionPercent ?? 1) <= TOP_THRESHOLD);
  const buried = found.filter((r) => (r.positionPercent ?? 0) > DEEP_THRESHOLD);

  let status: 'pass' | 'warn' | 'fail';
  let message: string;
  const pageLabel = sampled ? 'sampled pages' : 'pages';
  const suffix = fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : '';

  if (found.length === 0) {
    status = 'fail';
    message = `No llms.txt directive found in any of ${tested.length} ${pageLabel}${suffix}`;
  } else if (buried.length > 0 && nearTop.length === 0) {
    // All found directives are buried deep
    status = 'warn';
    message = `llms.txt directive found in ${found.length} of ${tested.length} ${pageLabel}, but buried deep in the page (past ${Math.round(DEEP_THRESHOLD * 100)}%)${suffix}`;
  } else if (notFound.length > 0) {
    // Some pages have directives, some don't
    status = 'warn';
    message = `llms.txt directive found in ${found.length} of ${tested.length} ${pageLabel} (${notFound.length} missing)${suffix}`;
  } else {
    status = 'pass';
    message = `llms.txt directive found in all ${tested.length} ${pageLabel}${nearTop.length > 0 ? ', near the top of content' : ''}${suffix}`;
  }

  return {
    id,
    category,
    status,
    message,
    details: {
      totalPages,
      testedPages: tested.length,
      sampled,
      foundCount: found.length,
      notFoundCount: notFound.length,
      nearTopCount: nearTop.length,
      buriedCount: buried.length,
      fetchErrors,
      pageResults: results,
      discoveryWarnings: warnings,
    },
  };
}

registerCheck({
  id: 'llms-txt-directive',
  category: 'content-discoverability',
  description: 'Whether pages include a directive pointing to llms.txt',
  dependsOn: [],
  run: check,
});
