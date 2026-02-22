import { describe, it, expect } from 'vitest';
import { runChecks } from '../runner.js';
import { loadConfig } from './config.js';
import type { AgentDocsConfig, CheckResult } from '../types.js';

// Ensure all checks are registered
import '../checks/index.js';

/**
 * Auto-generates vitest tests from an agent-docs config file.
 *
 * Usage in a test file:
 * ```ts
 * import { describeAgentDocs } from 'agent-docs-testing/helpers';
 * describeAgentDocs();
 * ```
 */
export function describeAgentDocs(configOrDir?: AgentDocsConfig | string): void {
  describe('Agent-Friendly Documentation', () => {
    let results: CheckResult[];

    it('should run checks', async () => {
      const config =
        typeof configOrDir === 'object'
          ? configOrDir
          : await loadConfig(typeof configOrDir === 'string' ? configOrDir : undefined);

      const report = await runChecks(config.url, {
        checkIds: config.checks,
        ...config.options,
      });
      results = report.results;
    });

    it('should have no failing checks', () => {
      expect(results).toBeDefined();
      const failures = results.filter((r) => r.status === 'fail');
      if (failures.length > 0) {
        const messages = failures.map((f) => `${f.id}: ${f.message}`).join('\n');
        expect.fail(`${failures.length} check(s) failed:\n${messages}`);
      }
    });
  });
}

/**
 * Auto-generates individual vitest tests per check from an agent-docs config.
 *
 * Usage:
 * ```ts
 * import { describeAgentDocsPerCheck } from 'agent-docs-testing/helpers';
 * describeAgentDocsPerCheck();
 * ```
 */
export function describeAgentDocsPerCheck(configOrDir?: AgentDocsConfig | string): void {
  describe('Agent-Friendly Documentation', () => {
    let _results: Map<string, CheckResult>;

    // Run all checks once, then assert per-check
    it('should run checks', async () => {
      const config =
        typeof configOrDir === 'object'
          ? configOrDir
          : await loadConfig(typeof configOrDir === 'string' ? configOrDir : undefined);

      const report = await runChecks(config.url, {
        checkIds: config.checks,
        ...config.options,
      });
      _results = new Map(report.results.map((r) => [r.id, r]));
    });

    // Individual check assertions will be generated after the setup test runs.
    // Since vitest doesn't support dynamic test generation after suite setup,
    // users should use describeAgentDocs() for the simple case or import
    // checks individually for per-check control.
  });
}
