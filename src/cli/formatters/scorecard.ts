import chalk from 'chalk';
import type { ReportResult } from '../../types.js';
import type { ScoreResult, Diagnostic } from '../../scoring/types.js';
import { computeScore } from '../../scoring/index.js';
import { CATEGORIES, SPEC_BASE_URL } from '../../constants.js';

const STATUS_LABELS: Record<string, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  skip: 'SKIP',
  error: 'ERR ',
};

const STATUS_COLORS: Record<string, (s: string) => string> = {
  pass: chalk.green,
  warn: chalk.yellow,
  fail: chalk.red,
  skip: chalk.gray,
  error: chalk.red,
};

const GRADE_COLORS: Record<string, (s: string) => string> = {
  'A+': chalk.green,
  A: chalk.green,
  B: chalk.green,
  C: chalk.yellow,
  D: chalk.red,
  F: chalk.red,
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: chalk.red('[!]'),
  warning: chalk.yellow('[!]'),
  info: chalk.blue('[i]'),
};

function gradeColor(grade: string): (s: string) => string {
  return GRADE_COLORS[grade] ?? ((s: string) => s);
}

function formatCategoryLine(name: string, score: number, grade: string): string {
  const paddedName = name.padEnd(36);
  const scoreStr = `${score} / 100`;
  const coloredGrade = gradeColor(grade)(`(${grade})`);
  return `    ${paddedName} ${scoreStr.padStart(9)} ${coloredGrade}`;
}

function formatDiagnostic(diag: Diagnostic): string[] {
  const icon = SEVERITY_ICONS[diag.severity] ?? '[?]';
  const lines: string[] = [];
  // Extract first sentence for heading. Split on ". " (period + space) rather than
  // bare "." to avoid breaking on file extensions like .md or llms.txt.
  const firstSentenceEnd = diag.message.indexOf('. ');
  const heading = firstSentenceEnd !== -1 ? diag.message.slice(0, firstSentenceEnd) : diag.message;
  lines.push(`    ${icon} ${chalk.bold(heading)}`);

  // Full message as detail text
  const fullMsg = diag.message;
  lines.push(`        ${chalk.dim(fullMsg)}`);
  lines.push('');
  lines.push(`        ${chalk.cyan('Fix:')} ${diag.resolution}`);

  return lines;
}

export function formatScorecard(report: ReportResult, scoreResult?: ScoreResult): string {
  const score = scoreResult ?? computeScore(report);
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold('Agent-Friendly Docs Scorecard'));
  lines.push(chalk.bold('=============================='));
  lines.push('');
  lines.push(chalk.gray(`${report.url} · ${report.timestamp}`));
  lines.push('');

  // Overall score
  const overallColor = gradeColor(score.grade);
  lines.push(
    `  ${chalk.bold('Overall Score:')} ${overallColor(`${score.overall} / 100`)} ${overallColor(`(${score.grade})`)}`,
  );

  if (score.cap) {
    lines.push(`  ${chalk.dim(`(Capped: ${score.cap.checkId} — ${score.cap.reason})`)}`);
  }

  lines.push('');

  // Category scores
  lines.push(`  ${chalk.bold('Category Scores:')}`);
  for (const cat of CATEGORIES) {
    const catScore = score.categoryScores[cat.id];
    if (catScore) {
      lines.push(formatCategoryLine(cat.name, catScore.score, catScore.grade));
    }
  }
  lines.push('');

  // Interaction diagnostics
  if (score.diagnostics.length > 0) {
    lines.push(`  ${chalk.bold('Interaction Diagnostics:')}`);
    for (const diag of score.diagnostics) {
      lines.push(...formatDiagnostic(diag));
      lines.push('');
    }
  }

  // Check results grouped by category
  lines.push(`  ${chalk.bold('Check Results:')}`);
  lines.push('');

  const byCategory = new Map<string, typeof report.results>();
  for (const result of report.results) {
    const existing = byCategory.get(result.category) ?? [];
    existing.push(result);
    byCategory.set(result.category, existing);
  }

  for (const cat of CATEGORIES) {
    const results = byCategory.get(cat.id);
    if (!results) continue;

    lines.push(`    ${chalk.bold.underline(cat.name)}`);
    for (const result of results) {
      const label = STATUS_LABELS[result.status] ?? '????';
      const color = STATUS_COLORS[result.status] ?? ((s: string) => s);
      lines.push(`      ${color(label)}  ${result.id.padEnd(30)} ${result.message}`);

      // Resolution text for warn/fail
      const resolution = score.resolutions[result.id];
      if (resolution) {
        lines.push(`            ${chalk.cyan('Fix:')} ${resolution}`);
      }
    }
    lines.push('');
  }

  // Footer
  lines.push(chalk.dim(`Full spec: ${SPEC_BASE_URL}`));
  lines.push('');

  return lines.join('\n');
}
