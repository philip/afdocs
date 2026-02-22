import { describe, it, expect } from 'vitest';
import { formatText } from '../../../src/cli/formatters/text.js';
import { formatJson } from '../../../src/cli/formatters/json.js';
import type { ReportResult } from '../../../src/types.js';

function makeReport(overrides?: Partial<ReportResult>): ReportResult {
  return {
    url: 'http://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [
      { id: 'llms-txt-exists', category: 'llms-txt', status: 'pass', message: 'Found' },
      {
        id: 'llms-txt-valid',
        category: 'llms-txt',
        status: 'warn',
        message: 'Non-standard structure',
      },
      {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'fail',
        message: 'No .md URLs',
      },
      { id: 'llms-txt-size', category: 'llms-txt', status: 'skip', message: 'Skipped' },
      { id: 'page-size-html', category: 'page-size', status: 'error', message: 'Timeout' },
    ],
    summary: { total: 5, pass: 1, warn: 1, fail: 1, skip: 1, error: 1 },
    ...overrides,
  };
}

describe('formatText', () => {
  it('includes the URL and timestamp', () => {
    const output = formatText(makeReport());
    expect(output).toContain('http://example.com');
    expect(output).toContain('2026-01-01T00:00:00.000Z');
  });

  it('groups results by category', () => {
    const output = formatText(makeReport());
    // llms-txt category should appear before markdown-availability
    const llmsIdx = output.indexOf('llms-txt');
    const mdIdx = output.indexOf('markdown-availability');
    expect(llmsIdx).toBeLessThan(mdIdx);
  });

  it('shows all check IDs and messages', () => {
    const output = formatText(makeReport());
    expect(output).toContain('llms-txt-exists');
    expect(output).toContain('Found');
    expect(output).toContain('llms-txt-valid');
    expect(output).toContain('Non-standard structure');
    expect(output).toContain('markdown-url-support');
    expect(output).toContain('No .md URLs');
  });

  it('shows summary with all status counts', () => {
    const output = formatText(makeReport());
    expect(output).toContain('1 passed');
    expect(output).toContain('1 warnings');
    expect(output).toContain('1 failed');
    expect(output).toContain('1 skipped');
    expect(output).toContain('1 errors');
    expect(output).toContain('5 total');
  });

  it('omits zero-count statuses from summary', () => {
    const report = makeReport({
      results: [{ id: 'check-a', category: 'cat', status: 'pass', message: 'OK' }],
      summary: { total: 1, pass: 1, warn: 0, fail: 0, skip: 0, error: 0 },
    });
    const output = formatText(report);
    expect(output).toContain('1 passed');
    expect(output).not.toContain('warnings');
    expect(output).not.toContain('failed');
    expect(output).not.toContain('skipped');
    expect(output).not.toContain('errors');
  });
});

describe('formatJson', () => {
  it('returns valid JSON', () => {
    const output = formatJson(makeReport());
    const parsed = JSON.parse(output);
    expect(parsed.url).toBe('http://example.com');
    expect(parsed.results).toHaveLength(5);
    expect(parsed.summary.total).toBe(5);
  });

  it('is pretty-printed', () => {
    const output = formatJson(makeReport());
    expect(output).toContain('\n');
    expect(output).toContain('  ');
  });
});
