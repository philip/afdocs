import { registerCheck } from '../registry.js';
import { looksLikeHtml } from '../../helpers/detect-markdown.js';
import { discoverAndSamplePages } from '../../helpers/get-page-urls.js';
import { htmlToMarkdown } from '../../helpers/html-to-markdown.js';
import type { CheckContext, CheckResult, CheckStatus } from '../../types.js';

interface PagePositionResult {
  url: string;
  contentStartChar: number;
  totalChars: number;
  contentStartPercent: number;
  status: CheckStatus;
  error?: string;
}

const CSS_PATTERN = /[{}\s]*[a-z-]+\s*:\s*[^;]+;/;
const JS_PATTERNS = [/^\s*(function|var|const|let|import|export)\b/, /^\s*\/\//, /[{};]\s*$/];
const NAV_MAX_LENGTH = 40;

/**
 * Find the character position where meaningful content begins in converted markdown.
 * Meaningful content is a heading or a prose paragraph (not CSS, JS, or short nav text).
 */
function findContentStart(markdown: string): number {
  const lines = markdown.split('\n');
  let charPos = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      charPos += line.length + 1;
      continue;
    }

    // ATX heading: starts with # at beginning of line
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      return charPos;
    }

    // Setext heading: current line is text, next line is === or ---
    const nextLine = idx + 1 < lines.length ? lines[idx + 1].trim() : '';
    if (/^[=-]+$/.test(nextLine) && nextLine.length >= 2 && trimmed.length > 0) {
      return charPos;
    }

    // Skip CSS-like lines
    if (CSS_PATTERN.test(trimmed)) {
      charPos += line.length + 1;
      continue;
    }

    // Skip JS-like lines
    if (JS_PATTERNS.some((p) => p.test(trimmed))) {
      charPos += line.length + 1;
      continue;
    }

    // Skip very short nav-like tokens (e.g., "Home", "Docs", "API")
    if (trimmed.length <= NAV_MAX_LENGTH && !/[.!?]/.test(trimmed) && !trimmed.includes(' ')) {
      charPos += line.length + 1;
      continue;
    }

    // Prose-like paragraph: contains spaces (multiple words) and is reasonably long
    if (trimmed.length > NAV_MAX_LENGTH || (trimmed.includes(' ') && trimmed.length > 20)) {
      return charPos;
    }

    charPos += line.length + 1;
  }

  // If nothing matched, content starts at the end (all boilerplate)
  return charPos;
}

function positionStatus(percent: number): CheckStatus {
  if (percent <= 10) return 'pass';
  if (percent <= 50) return 'warn';
  return 'fail';
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'content-start-position';
  const category = 'page-size';

  const {
    urls: pageUrls,
    totalPages,
    sampled: wasSampled,
    warnings,
  } = await discoverAndSamplePages(ctx);

  const results: PagePositionResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<PagePositionResult> => {
        try {
          const response = await ctx.http.fetch(url);
          const body = await response.text();
          const contentType = response.headers.get('content-type') ?? '';
          const isMarkdownType =
            contentType.includes('text/markdown') || contentType.includes('text/plain');
          const isHtml =
            !isMarkdownType && (contentType.includes('text/html') || looksLikeHtml(body));
          const markdown = isHtml ? htmlToMarkdown(body) : body;
          const totalChars = markdown.length;
          const contentStartChar = findContentStart(markdown);
          const contentStartPercent =
            totalChars > 0 ? Math.round((contentStartChar / totalChars) * 100) : 0;

          return {
            url,
            contentStartChar,
            totalChars,
            contentStartPercent,
            status: positionStatus(contentStartPercent),
          };
        } catch (err) {
          return {
            url,
            contentStartChar: 0,
            totalChars: 0,
            contentStartPercent: 100,
            status: 'fail',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...batchResults);
  }

  const successful = results.filter((r) => !r.error);
  const fetchErrors = results.filter((r) => r.error).length;

  if (successful.length === 0) {
    return {
      id,
      category,
      status: 'fail',
      message: `Could not fetch any pages to analyze${fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : ''}`,
      details: {
        totalPages,
        testedPages: results.length,
        sampled: wasSampled,
        fetchErrors,
        pageResults: results,
        discoveryWarnings: warnings,
      },
    };
  }

  const percents = successful.map((r) => r.contentStartPercent);
  const medianPercent = percents.sort((a, b) => a - b)[Math.floor(percents.length / 2)];
  const maxPercent = Math.max(...percents);

  const overallStatus = worstStatus(successful.map((r) => r.status));
  const pageLabel = wasSampled ? 'sampled pages' : 'pages';

  const passBucket = successful.filter((r) => r.status === 'pass').length;
  const warnBucket = successful.filter((r) => r.status === 'warn').length;
  const failBucket = successful.filter((r) => r.status === 'fail').length;

  const suffix = fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : '';

  let message: string;
  if (overallStatus === 'pass') {
    message = `Content starts within first 10% on all ${successful.length} ${pageLabel} (median ${medianPercent}%)${suffix}`;
  } else if (overallStatus === 'warn') {
    message = `${warnBucket} of ${successful.length} ${pageLabel} have content starting at 10–50% (worst ${maxPercent}%)${suffix}`;
  } else {
    message = `${failBucket} of ${successful.length} ${pageLabel} have content starting past 50% (worst ${maxPercent}%)${suffix}`;
  }

  return {
    id,
    category,
    status: overallStatus,
    message,
    details: {
      totalPages,
      testedPages: results.length,
      sampled: wasSampled,
      medianPercent,
      maxPercent,
      passBucket,
      warnBucket,
      failBucket,
      fetchErrors,
      pageResults: results,
      discoveryWarnings: warnings,
    },
  };
}

registerCheck({
  id: 'content-start-position',
  category: 'page-size',
  description: 'How far into content the actual documentation begins',
  dependsOn: [],
  run: check,
});
