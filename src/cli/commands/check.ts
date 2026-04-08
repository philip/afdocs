import type { Command } from 'commander';
import { normalizeUrl, runChecks } from '../../runner.js';
import { formatText } from '../formatters/text.js';
import { formatJson } from '../formatters/json.js';
import { formatScorecard } from '../formatters/scorecard.js';
import type { PageConfigEntry, SamplingStrategy } from '../../types.js';
import { findConfig } from '../../helpers/config.js';

// Ensure all checks are registered
import '../../checks/index.js';

const SAMPLING_STRATEGIES = ['random', 'deterministic', 'curated', 'none'] as const;
const FORMAT_OPTIONS = ['text', 'json', 'scorecard'] as const;

export function registerCheckCommand(program: Command): void {
  program
    .command('check [url]')
    .description('Run agent-friendly documentation checks against a URL')
    .option('--config <path>', 'Path to config file (default: auto-discover agent-docs.config.yml)')
    .option('-f, --format <format>', 'Output format: text, json, or scorecard', 'text')
    .option('-c, --checks <checks>', 'Comma-separated list of check IDs to run')
    .option('--max-concurrency <n>', 'Maximum concurrent requests')
    .option('--request-delay <ms>', 'Delay between requests in ms')
    .option('--max-links <n>', 'Maximum links to test')
    .option(
      '--sampling <strategy>',
      'URL sampling strategy: random, deterministic, curated, or none',
    )
    .option(
      '--urls <urls>',
      'Comma-separated page URLs for curated scoring (implies --sampling curated)',
    )
    .option('--pass-threshold <n>', 'Pass threshold in characters')
    .option('--fail-threshold <n>', 'Fail threshold in characters')
    .option('-v, --verbose', 'Show per-page details for checks with issues')
    .option('--fixes', 'Show fix suggestions for warn/fail checks')
    .option('--score', 'Include scoring data in JSON output')
    .action(async (rawUrl: string | undefined, opts: Record<string, unknown>) => {
      // Load config: explicit path or auto-discover
      let config;
      try {
        config = await findConfig(opts.config as string | undefined);
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
        return;
      }

      // Resolve URL: CLI arg > config url > error
      const resolvedUrl = rawUrl ?? config?.url;
      if (!resolvedUrl) {
        process.stderr.write(
          'Error: No URL provided. Pass a URL as an argument or set "url" in agent-docs.config.yml\n',
        );
        process.exitCode = 1;
        return;
      }
      const url = normalizeUrl(resolvedUrl);

      // Resolve options: CLI flags > config > hardcoded defaults
      const checkIds = opts.checks
        ? (opts.checks as string).split(',').map((s) => s.trim())
        : config?.checks;

      const format = opts.format as string;
      if (!FORMAT_OPTIONS.includes(format as (typeof FORMAT_OPTIONS)[number])) {
        process.stderr.write(
          `Error: Invalid format "${format}". Must be one of: ${FORMAT_OPTIONS.join(', ')}\n`,
        );
        process.exitCode = 1;
        return;
      }

      // Determine curated pages and sampling strategy
      let curatedPages: PageConfigEntry[] | undefined;
      let samplingRaw: string;

      if (opts.urls) {
        // --urls flag: parse comma-separated URLs, force curated strategy
        curatedPages = (opts.urls as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        samplingRaw = 'curated';
      } else if (config?.pages && config.pages.length > 0) {
        // Config has pages: use them, default to curated unless explicitly overridden
        curatedPages = config.pages;
        samplingRaw =
          (opts.sampling as string | undefined) ?? config?.options?.samplingStrategy ?? 'curated';
      } else {
        // No curated pages: standard behavior
        samplingRaw =
          (opts.sampling as string | undefined) ?? config?.options?.samplingStrategy ?? 'random';
      }

      const sampling = samplingRaw as SamplingStrategy;
      if (!SAMPLING_STRATEGIES.includes(sampling)) {
        process.stderr.write(
          `Error: Invalid sampling strategy "${sampling}". Must be one of: ${SAMPLING_STRATEGIES.join(', ')}\n`,
        );
        process.exitCode = 1;
        return;
      }

      const maxConcurrency = parseInt(
        String((opts.maxConcurrency as string | undefined) ?? config?.options?.maxConcurrency ?? 3),
        10,
      );
      const requestDelay = parseInt(
        String((opts.requestDelay as string | undefined) ?? config?.options?.requestDelay ?? 200),
        10,
      );
      const maxLinksToTest = parseInt(
        String((opts.maxLinks as string | undefined) ?? config?.options?.maxLinksToTest ?? 50),
        10,
      );
      const passThreshold = parseInt(
        String(
          (opts.passThreshold as string | undefined) ?? config?.options?.thresholds?.pass ?? 50000,
        ),
        10,
      );
      const failThreshold = parseInt(
        String(
          (opts.failThreshold as string | undefined) ?? config?.options?.thresholds?.fail ?? 100000,
        ),
        10,
      );

      if (format !== 'json') {
        const parsed = new URL(url);
        const target =
          parsed.pathname && parsed.pathname !== '/'
            ? `${parsed.hostname}${parsed.pathname}`
            : parsed.hostname;
        process.stderr.write(`Running checks on ${target}...\n`);
      }

      const report = await runChecks(url, {
        checkIds,
        maxConcurrency,
        requestDelay,
        maxLinksToTest,
        samplingStrategy: sampling,
        curatedPages,
        thresholds: {
          pass: passThreshold,
          fail: failThreshold,
        },
      });

      let output: string;
      if (format === 'json') {
        const includeScore = !!opts.score;
        output = formatJson(report, { score: includeScore });
      } else if (format === 'scorecard') {
        output = formatScorecard(report);
      } else {
        output = formatText(report, { verbose: !!opts.verbose, fixes: !!opts.fixes });
      }
      process.stdout.write(output + '\n');

      // Exit 1 if any check failed
      const hasFailure = report.results.some((r) => r.status === 'fail');
      if (hasFailure) {
        process.exitCode = 1;
      }
    });
}
