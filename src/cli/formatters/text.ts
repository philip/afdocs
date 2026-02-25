import chalk from 'chalk';
import type { ReportResult, CheckResult } from '../../types.js';

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
      .filter((p) => !p.supported)
      .map((p) => formatDetailLine('warn', p.url, 'no .md URL found'));
  },

  'content-negotiation': (details) => {
    const pages = details.pageResults as PageResult[] | undefined;
    if (!pages) return [];
    return pages
      .filter((p) => p.status !== 'pass')
      .map((p) => {
        const classification = (p.classification as string) ?? '';
        return formatDetailLine(p.status, p.url, classification);
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

function formatResult(result: CheckResult): string {
  const icon = STATUS_ICONS[result.status] ?? '?';
  const color = STATUS_COLORS[result.status] ?? ((s: string) => s);
  return `  ${icon} ${color(result.id)}: ${result.message}`;
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
}

export function formatText(report: ReportResult, options?: FormatTextOptions): string {
  const verbose = options?.verbose ?? false;
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
      lines.push(formatResult(result));
      if (verbose) {
        lines.push(...formatVerboseDetails(result));
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

  return lines.join('\n');
}
