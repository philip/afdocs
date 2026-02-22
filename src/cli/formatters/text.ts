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

function formatResult(result: CheckResult): string {
  const icon = STATUS_ICONS[result.status] ?? '?';
  const color = STATUS_COLORS[result.status] ?? ((s: string) => s);
  return `  ${icon} ${color(result.id)}: ${result.message}`;
}

export function formatText(report: ReportResult): string {
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
