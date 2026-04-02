import chalk from 'chalk';
import type { ReportResult, CheckResult } from '../../types.js';
import { SPEC_BASE_URL } from '../../constants.js';
import { getResolution } from '../../scoring/resolutions.js';

const STATUS_ICONS: Record<string, string> = {
  pass: chalk.green('✓'),
  warn: chalk.yellow('⚠'),
  fail: chalk.red('✗'),
  skip: chalk.gray('○'),
  error: chalk.red('!'),
};

const STATUS_COLORS: Record<string, (s: string) => string> = {
  pass: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
  skip: chalk.gray,
  error: chalk.red,
};

interface PageResult {
  url: string;
  status: string;
  [key: string]: unknown;
}

type DetailFormatter = (details: Record<string, unknown>) => string[];

function formatSize(chars: number): string {
  if (chars >= 1000) return `${Math.round(chars / 1000)}K chars`;
  return `${chars} chars`;
}

const DETAIL_FORMATTERS: Record<string, DetailFormatter> = {
  'page-size-html': (details) => {
    const pages = details.pageResults as PageResult[] | undefined;
    if (!pages) return [];
    return pages
      .filter((p) => p.status !== 'pass')
      .map((p) => {
        const size = formatSize(p.convertedCharacters as number);
        return formatDetailLine(p.status, p.url, size);
      });
  },

  'page-size-markdown': (details) => {
    const pages = details.pageResults as PageResult[] | undefined;
    if (!pages) return [];
    return pages
      .filter((p) => p.status !== 'pass')
      .map((p) => {
        const size = formatSize(p.characters as number);
        const displayUrl = (p.mdUrl as string) ?? p.url;
        return formatDetailLine(p.status, displayUrl, size);
      });
  },

  'content-start-position': (details) => {
    const pages = details.pageResults as PageResult[] | undefined;
    if (!pages) return [];
    return pages
      .filter((p) => p.status !== 'pass')
      .map((p) => {
        const pct = `${p.contentStartPercent}%`;
        return formatDetailLine(p.status, p.url, pct);
      });
  },

  'markdown-url-support': (details) => {
    const pages = details.pageResults as PageResult[] | undefined;
    if (!pages) return [];
    return pages
      .filter((p) => !p.supported && !p.skipped)
      .map((p) => {
        const msg = p.alreadyMd ? '.md URL serves HTML, not markdown' : 'no .md URL found';
        return formatDetailLine('warn', p.url, msg);
      });
  },

  'content-negotiation': (details) => {
    const pages = details.pageResults as PageResult[] | undefined;
    if (!pages) return [];
    return pages
      .filter((p) => p.classification !== 'markdown-with-correct-type' && !p.skipped)
      .map((p) => {
        const status = p.classification === 'markdown-with-wrong-type' ? 'warn' : 'fail';
        const urlIsMd = /\.mdx?$/i.test(new URL(p.url).pathname);
        let label: string;
        if (p.classification === 'markdown-with-wrong-type') {
          const ct = (p.contentType as string) || 'unknown';
          label = `returns markdown but content-type is ${ct}`;
        } else if (urlIsMd) {
          label = '.md URL serves HTML, not markdown';
        } else {
          label = 'returns HTML, ignores Accept header';
        }
        return formatDetailLine(status, p.url, label);
      });
  },

  'markdown-code-fence-validity': (details) => {
    const pages = details.pageResults as PageResult[] | undefined;
    if (!pages) return [];
    return pages
      .filter((p) => p.status !== 'pass')
      .flatMap((p) => {
        const issues = (p.issues as Array<{ line: number; type: string; opener: string }>) ?? [];
        return issues.map((issue) => {
          const info = `unclosed ${issue.opener} at line ${issue.line}`;
          return formatDetailLine('fail', p.url, info);
        });
      });
  },

  'llms-txt-links-resolve': (details) => {
    const broken = details.broken as
      | Array<{ url: string; status: number; error?: string }>
      | undefined;
    if (!broken) return [];
    return broken.map((b) => {
      const info = b.error ?? `HTTP ${b.status}`;
      return formatDetailLine('fail', b.url, info);
    });
  },
};

function formatDetailLine(status: string, url: string, metric: string): string {
  const icon = STATUS_ICONS[status] ?? STATUS_ICONS.warn;
  return `      ${icon} ${url} ${chalk.dim(metric)}`;
}

/** Check IDs whose results may be unreliable when rendering-strategy fails. */
const RENDERING_SENSITIVE_CHECKS = new Set(['page-size-html', 'content-start-position']);

function formatResult(result: CheckResult, allResults?: CheckResult[]): string {
  const icon = STATUS_ICONS[result.status] ?? '?';
  const color = STATUS_COLORS[result.status] ?? ((s: string) => s);
  let line = `  ${icon} ${color(result.id)}: ${result.message}`;

  // Add caveat when rendering-strategy failed and this check measures HTML content
  if (RENDERING_SENSITIVE_CHECKS.has(result.id) && allResults) {
    const renderResult = allResults.find((r) => r.id === 'rendering-strategy');
    if (renderResult?.status === 'fail') {
      line += `\n      ${chalk.dim('Note: rendering-strategy detected SPA shells; these measurements may reflect a shell, not actual content')}`;
    }
  }

  // Add spec link for warn/fail/error results
  if (result.status === 'warn' || result.status === 'fail' || result.status === 'error') {
    line += `\n      ${chalk.dim(`Learn more: ${SPEC_BASE_URL}#${result.id}`)}`;
  }

  return line;
}

function formatVerboseDetails(result: CheckResult): string[] {
  if (!result.details) return [];

  const lines: string[] = [];

  const formatter = DETAIL_FORMATTERS[result.id];
  if (formatter) {
    lines.push(...formatter(result.details));
  }

  const warnings = result.details.discoveryWarnings as string[] | undefined;
  if (warnings && warnings.length > 0) {
    for (const w of warnings) {
      lines.push(`      ${chalk.yellow('⚠')} ${chalk.dim(w)}`);
    }
  }

  return lines;
}

export interface FormatTextOptions {
  verbose?: boolean;
  fixes?: boolean;
}

export function formatText(report: ReportResult, options?: FormatTextOptions): string {
  const verbose = options?.verbose ?? false;
  const fixes = options?.fixes ?? false;
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold(`Agent-Friendly Docs Check: ${report.url}`));
  lines.push(chalk.gray(`Timestamp: ${report.timestamp}`));
  lines.push('');

  // Group by category
  const byCategory = new Map<string, CheckResult[]>();
  for (const result of report.results) {
    const existing = byCategory.get(result.category) ?? [];
    existing.push(result);
    byCategory.set(result.category, existing);
  }

  for (const [category, results] of byCategory) {
    lines.push(chalk.bold.underline(category));
    for (const result of results) {
      lines.push(formatResult(result, report.results));
      if (verbose) {
        lines.push(...formatVerboseDetails(result));
      }
      if (fixes) {
        const resolution = getResolution(result);
        if (resolution) {
          lines.push(`      ${chalk.cyan('Fix:')} ${resolution}`);
        }
      }
    }
    lines.push('');
  }

  // Summary
  lines.push(chalk.bold('Summary'));
  const { summary } = report;
  const parts: string[] = [];
  if (summary.pass > 0) parts.push(chalk.green(`${summary.pass} passed`));
  if (summary.warn > 0) parts.push(chalk.yellow(`${summary.warn} warnings`));
  if (summary.fail > 0) parts.push(chalk.red(`${summary.fail} failed`));
  if (summary.skip > 0) parts.push(chalk.gray(`${summary.skip} skipped`));
  if (summary.error > 0) parts.push(chalk.red(`${summary.error} errors`));
  lines.push(`  ${parts.join(', ')} (${summary.total} total)`);
  lines.push('');
  lines.push(chalk.dim(`Full spec: ${SPEC_BASE_URL}`));
  lines.push('');

  return lines.join('\n');
}
