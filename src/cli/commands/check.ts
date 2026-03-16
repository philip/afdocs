import type { Command } from 'commander';
import { runChecks } from '../../runner.js';
import { formatText } from '../formatters/text.js';
import { formatJson } from '../formatters/json.js';
import type { SamplingStrategy } from '../../types.js';

// Ensure all checks are registered
import '../../checks/index.js';

const SAMPLING_STRATEGIES = ['random', 'deterministic', 'none'] as const;

export function registerCheckCommand(program: Command): void {
  program
    .command('check <url>')
    .description('Run agent-friendly documentation checks against a URL')
    .option('-f, --format <format>', 'Output format: text or json', 'text')
    .option('-c, --checks <checks>', 'Comma-separated list of check IDs to run')
    .option('--max-concurrency <n>', 'Maximum concurrent requests', '3')
    .option('--request-delay <ms>', 'Delay between requests in ms', '200')
    .option('--max-links <n>', 'Maximum links to test', '50')
    .option(
      '--sampling <strategy>',
      'URL sampling strategy: random, deterministic, or none',
      'random',
    )
    .option('--pass-threshold <n>', 'Pass threshold in characters', '50000')
    .option('--fail-threshold <n>', 'Fail threshold in characters', '100000')
    .option('-v, --verbose', 'Show per-page details for checks with issues')
    .action(async (url: string, opts: Record<string, string>) => {
      const checkIds = opts.checks ? opts.checks.split(',').map((s) => s.trim()) : undefined;
      const isText = opts.format !== 'json';

      const sampling = opts.sampling as SamplingStrategy;
      if (!SAMPLING_STRATEGIES.includes(sampling)) {
        process.stderr.write(
          `Error: Invalid sampling strategy "${sampling}". Must be one of: ${SAMPLING_STRATEGIES.join(', ')}\n`,
        );
        process.exitCode = 1;
        return;
      }

      if (isText) {
        const domain = new URL(url).hostname;
        process.stderr.write(`Running checks on ${domain}...\n`);
      }

      const report = await runChecks(url, {
        checkIds,
        maxConcurrency: parseInt(opts.maxConcurrency, 10),
        requestDelay: parseInt(opts.requestDelay, 10),
        maxLinksToTest: parseInt(opts.maxLinks, 10),
        samplingStrategy: sampling,
        thresholds: {
          pass: parseInt(opts.passThreshold, 10),
          fail: parseInt(opts.failThreshold, 10),
        },
      });

      const output =
        opts.format === 'json'
          ? formatJson(report)
          : formatText(report, { verbose: !!opts.verbose });
      process.stdout.write(output + '\n');

      // Exit 1 if any check failed
      const hasFailure = report.results.some((r) => r.status === 'fail');
      if (hasFailure) {
        process.exitCode = 1;
      }
    });
}
