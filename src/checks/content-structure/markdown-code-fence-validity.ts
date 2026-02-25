import { registerCheck } from '../registry.js';
import { getMarkdownContent } from '../../helpers/get-markdown-content.js';
import type { CheckContext, CheckResult, CheckStatus } from '../../types.js';

interface FenceIssue {
  line: number;
  type: 'unclosed' | 'inconsistent-close';
  opener: string;
  closer?: string;
}

interface PageFenceResult {
  url: string;
  source: string;
  fenceCount: number;
  issues: FenceIssue[];
  status: CheckStatus;
}

/**
 * Strip blockquote prefixes (`> `) from a line so that fences inside
 * blockquotes are detected the same way a CommonMark parser would
 * handle them. Supports nested blockquotes (`> > `).
 */
function stripBlockquotePrefix(line: string): string {
  return line.replace(/^(?:\s{0,3}> ?)+/, '');
}

/** Match a line that opens or closes a code fence (after blockquote stripping). */
const FENCE_RE = /^( {0,3})((`{3,})|(~{3,}))(.*)?$/;

function analyzeFences(content: string): { fenceCount: number; issues: FenceIssue[] } {
  const lines = content.split('\n');
  const issues: FenceIssue[] = [];
  let fenceCount = 0;
  let openFence: { line: number; char: string; length: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripBlockquotePrefix(lines[i]);
    const match = FENCE_RE.exec(stripped);
    if (!match) continue;

    // Skip fences inside markdown table cells (e.g. "``` | ```" or "| ```")
    // These aren't real CommonMark fences — multi-line table cells are a vendor extension
    if (stripped.includes('|')) continue;

    const char = match[3] ? '`' : '~';
    const length = (match[3] || match[4]).length;

    if (!openFence) {
      // Opening fence
      openFence = { line: i + 1, char, length };
      fenceCount++;
    } else {
      // Potential closing fence: must use same char and be at least as long
      if (char === openFence.char && length >= openFence.length) {
        // Proper close
        openFence = null;
      } else if (char !== openFence.char && length >= openFence.length) {
        // Inconsistent close: different delimiter type
        issues.push({
          line: i + 1,
          type: 'inconsistent-close',
          opener: openFence.char.repeat(openFence.length),
          closer: char.repeat(length),
        });
        openFence = null;
      }
      // Otherwise: different char + shorter length = not a close, just content inside the fence
    }
  }

  if (openFence) {
    issues.push({
      line: openFence.line,
      type: 'unclosed',
      opener: openFence.char.repeat(openFence.length),
    });
  }

  return { fenceCount, issues };
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'markdown-code-fence-validity';
  const category = 'content-structure';

  const mdResult = await getMarkdownContent(ctx);

  if (mdResult.pages.length === 0) {
    if (mdResult.mode === 'cached' && !mdResult.depPassed) {
      return {
        id,
        category,
        status: 'skip',
        message: 'Site does not serve markdown content; nothing to analyze',
      };
    }
    const hint =
      mdResult.mode === 'standalone'
        ? '; try running with markdown-url-support or content-negotiation checks'
        : '';
    return { id, category, status: 'skip', message: `No markdown content found${hint}` };
  }

  const results: PageFenceResult[] = mdResult.pages.map(({ url, content, source }) => {
    const { fenceCount, issues } = analyzeFences(content);
    const hasUnclosed = issues.some((i) => i.type === 'unclosed');
    const hasInconsistent = issues.some((i) => i.type === 'inconsistent-close');

    let status: CheckStatus;
    if (hasUnclosed) status = 'fail';
    else if (hasInconsistent) status = 'warn';
    else status = 'pass';

    return { url, source, fenceCount, issues, status };
  });

  const overallStatus = worstStatus(results.map((r) => r.status));
  const totalFences = results.reduce((sum, r) => sum + r.fenceCount, 0);
  const unclosedCount = results.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.type === 'unclosed').length,
    0,
  );
  const inconsistentCount = results.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.type === 'inconsistent-close').length,
    0,
  );

  let message: string;
  if (overallStatus === 'pass') {
    message = `All ${totalFences} code fences properly closed across ${results.length} pages`;
  } else if (overallStatus === 'warn') {
    message = `${inconsistentCount} code fences use inconsistent delimiters across ${results.length} pages`;
  } else {
    message = `${unclosedCount} unclosed code fences found across ${results.length} pages`;
  }

  return {
    id,
    category,
    status: overallStatus,
    message,
    details: {
      pagesAnalyzed: results.length,
      totalFences,
      unclosedCount,
      inconsistentCount,
      pageResults: results,
    },
  };
}

registerCheck({
  id: 'markdown-code-fence-validity',
  category: 'content-structure',
  description: 'Whether markdown contains unclosed code fences',
  dependsOn: [['markdown-url-support', 'content-negotiation']],
  run: check,
});
