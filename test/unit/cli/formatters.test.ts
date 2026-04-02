import { describe, it, expect } from 'vitest';
import { formatText } from '../../../src/cli/formatters/text.js';
import { formatJson } from '../../../src/cli/formatters/json.js';
import type { ReportResult } from '../../../src/types.js';

function makeReport(overrides?: Partial<ReportResult>): ReportResult {
  return {
    url: 'http://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [
      {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
      },
      {
        id: 'llms-txt-valid',
        category: 'content-discoverability',
        status: 'warn',
        message: 'Non-standard structure',
      },
      {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'fail',
        message: 'No .md URLs',
      },
      {
        id: 'llms-txt-size',
        category: 'content-discoverability',
        status: 'skip',
        message: 'Skipped',
      },
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

  it('shows small character counts without K suffix', () => {
    const report = makeReport({
      results: [
        {
          id: 'page-size-html',
          category: 'page-size',
          status: 'warn',
          message: 'Small page',
          details: {
            pageResults: [
              { url: 'https://example.com/tiny', convertedCharacters: 500, status: 'warn' },
            ],
          },
        },
      ],
      summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
    });
    const output = formatText(report, { verbose: true });
    expect(output).toContain('500 chars');
    expect(output).not.toContain('K chars');
  });

  describe('verbose mode', () => {
    it('shows per-page details for non-passing pageResults', () => {
      const report = makeReport({
        results: [
          {
            id: 'content-start-position',
            category: 'page-size',
            status: 'warn',
            message: '3 of 50 sampled pages have content starting at 10–50%',
            details: {
              pageResults: [
                { url: 'https://example.com/page1', contentStartPercent: 42, status: 'warn' },
                { url: 'https://example.com/page2', contentStartPercent: 5, status: 'pass' },
                { url: 'https://example.com/page3', contentStartPercent: 38, status: 'warn' },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      expect(output).toContain('https://example.com/page1');
      expect(output).toContain('42%');
      expect(output).toContain('https://example.com/page3');
      expect(output).toContain('38%');
      // Passing page should not appear
      expect(output).not.toContain('https://example.com/page2');
    });

    it('shows per-page details for page-size-html', () => {
      const report = makeReport({
        results: [
          {
            id: 'page-size-html',
            category: 'page-size',
            status: 'warn',
            message: '2 pages over threshold',
            details: {
              pageResults: [
                { url: 'https://example.com/big', convertedCharacters: 85000, status: 'fail' },
                { url: 'https://example.com/ok', convertedCharacters: 12000, status: 'pass' },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      expect(output).toContain('https://example.com/big');
      expect(output).toContain('85K chars');
      expect(output).not.toContain('https://example.com/ok');
    });

    it('shows markdown URL for page-size-markdown', () => {
      const report = makeReport({
        results: [
          {
            id: 'page-size-markdown',
            category: 'page-size',
            status: 'warn',
            message: '1 page over threshold',
            details: {
              pageResults: [
                {
                  url: 'https://example.com/large',
                  mdUrl: 'https://example.com/large.md',
                  characters: 62000,
                  status: 'warn',
                },
                {
                  url: 'https://example.com/small',
                  mdUrl: 'https://example.com/small.md',
                  characters: 5000,
                  status: 'pass',
                },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      expect(output).toContain('https://example.com/large.md');
      expect(output).toContain('62K chars');
      // Should show the .md URL, not the original
      expect(output).not.toContain('https://example.com/large ');
      expect(output).not.toContain('https://example.com/small');
    });

    it('shows per-page fence issues for markdown-code-fence-validity', () => {
      const report = makeReport({
        results: [
          {
            id: 'markdown-code-fence-validity',
            category: 'content-structure',
            status: 'fail',
            message: '1 unclosed code fences found across 2 pages',
            details: {
              pageResults: [
                {
                  url: 'https://example.com/good',
                  fenceCount: 3,
                  issues: [],
                  status: 'pass',
                },
                {
                  url: 'https://example.com/broken',
                  fenceCount: 2,
                  issues: [{ line: 15, type: 'unclosed', opener: '```' }],
                  status: 'fail',
                },
                {
                  url: 'https://example.com/also-broken',
                  fenceCount: 4,
                  issues: [{ line: 22, type: 'unclosed', opener: '```' }],
                  status: 'fail',
                },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 0, fail: 1, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      // Passing page should not appear
      expect(output).not.toContain('https://example.com/good');
      // Unclosed fence
      expect(output).toContain('https://example.com/broken');
      expect(output).toContain('unclosed ``` at line 15');
      // Second unclosed fence
      expect(output).toContain('https://example.com/also-broken');
      expect(output).toContain('unclosed ``` at line 22');
    });

    it('shows broken links for llms-txt-links-resolve', () => {
      const report = makeReport({
        results: [
          {
            id: 'llms-txt-links-resolve',
            category: 'content-discoverability',
            status: 'fail',
            message: '2 broken links',
            details: {
              broken: [
                { url: 'https://example.com/gone', status: 404 },
                { url: 'https://example.com/err', status: 0, error: 'ECONNREFUSED' },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 0, fail: 1, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      expect(output).toContain('https://example.com/gone');
      expect(output).toContain('HTTP 404');
      expect(output).toContain('https://example.com/err');
      expect(output).toContain('ECONNREFUSED');
    });

    it('shows nothing extra when all pageResults pass', () => {
      const report = makeReport({
        results: [
          {
            id: 'page-size-html',
            category: 'page-size',
            status: 'pass',
            message: 'All pages under threshold',
            details: {
              pageResults: [
                { url: 'https://example.com/a', convertedCharacters: 12000, status: 'pass' },
                { url: 'https://example.com/b', convertedCharacters: 8000, status: 'pass' },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 1, warn: 0, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      expect(output).not.toContain('https://example.com/a');
      expect(output).not.toContain('https://example.com/b');
    });

    it('only shows unsupported pages for markdown-url-support', () => {
      const report = makeReport({
        results: [
          {
            id: 'markdown-url-support',
            category: 'markdown-availability',
            status: 'warn',
            message: '1/3 pages support .md URLs',
            details: {
              pageResults: [
                {
                  url: 'https://example.com/good',
                  mdUrl: 'https://example.com/good.md',
                  supported: true,
                  status: 200,
                },
                {
                  url: 'https://example.com/bad',
                  mdUrl: 'https://example.com/bad.md',
                  supported: false,
                  status: 404,
                },
                {
                  url: 'https://example.com/docs/page.md',
                  mdUrl: 'https://example.com/docs/page.md',
                  supported: false,
                  alreadyMd: true,
                  status: 0,
                },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      expect(output).toContain('https://example.com/bad');
      expect(output).toContain('no .md URL found');
      // .md URL that serves HTML should show different message
      expect(output).toContain('https://example.com/docs/page.md');
      expect(output).toContain('.md URL serves HTML, not markdown');
      // Supported page should NOT appear
      expect(output).not.toContain('https://example.com/good');
    });

    it('shows non-markdown pages for content-negotiation', () => {
      const report = makeReport({
        results: [
          {
            id: 'content-negotiation',
            category: 'markdown-availability',
            status: 'warn',
            message: 'Content negotiation partially supported',
            details: {
              pageResults: [
                {
                  url: 'https://example.com/good',
                  classification: 'markdown-with-correct-type',
                  contentType: 'text/markdown',
                  status: 200,
                },
                {
                  url: 'https://example.com/wrong-type',
                  classification: 'markdown-with-wrong-type',
                  contentType: 'text/plain',
                  status: 200,
                },
                {
                  url: 'https://example.com/html-only',
                  classification: 'html',
                  contentType: 'text/html',
                  status: 200,
                },
                {
                  url: 'https://example.com/docs/page.md',
                  classification: 'html',
                  contentType: 'text/html',
                  status: 200,
                },
                {
                  url: 'https://example.com/openapi.json',
                  classification: 'html',
                  skipped: true,
                  contentType: '',
                  status: 0,
                },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      // markdown-with-correct-type should NOT appear (it's the good result)
      expect(output).not.toContain('https://example.com/good');
      // skipped pages should NOT appear
      expect(output).not.toContain('openapi.json');
      // wrong type should appear with descriptive message
      expect(output).toContain('https://example.com/wrong-type');
      expect(output).toContain('returns markdown but content-type is text/plain');
      // html-only should explain the server ignores the Accept header
      expect(output).toContain('https://example.com/html-only');
      expect(output).toContain('returns HTML, ignores Accept header');
      // .md URL that serves HTML should get its own message
      expect(output).toContain('https://example.com/docs/page.md');
      expect(output).toContain('.md URL serves HTML, not markdown');
    });

    it('shows nothing extra for checks with no details', () => {
      const report = makeReport({
        results: [
          {
            id: 'llms-txt-exists',
            category: 'content-discoverability',
            status: 'pass',
            message: 'Found',
          },
        ],
        summary: { total: 1, pass: 1, warn: 0, fail: 0, skip: 0, error: 0 },
      });
      const withVerbose = formatText(report, { verbose: true });
      const withoutVerbose = formatText(report);
      // Should be identical since there are no details to show
      expect(withVerbose).toBe(withoutVerbose);
    });

    it('shows discovery warnings when present', () => {
      const report = makeReport({
        results: [
          {
            id: 'page-size-html',
            category: 'page-size',
            status: 'pass',
            message: 'All pages under threshold',
            details: {
              pageResults: [],
              discoveryWarnings: ['Sitemap returned 404, used homepage links instead'],
            },
          },
        ],
        summary: { total: 1, pass: 1, warn: 0, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report, { verbose: true });
      expect(output).toContain('Sitemap returned 404, used homepage links instead');
    });

    it('shows SPA caveat on page-size-html when rendering-strategy fails', () => {
      const report = makeReport({
        results: [
          {
            id: 'rendering-strategy',
            category: 'page-size',
            status: 'fail',
            message: 'SPA shell detected',
          },
          {
            id: 'page-size-html',
            category: 'page-size',
            status: 'pass',
            message: 'All pages under threshold',
          },
          {
            id: 'content-start-position',
            category: 'page-size',
            status: 'warn',
            message: 'Content starts late',
          },
        ],
        summary: { total: 3, pass: 1, warn: 1, fail: 1, skip: 0, error: 0 },
      });
      const output = formatText(report);
      // Both sensitive checks should show the SPA caveat
      const spaNote = 'rendering-strategy detected SPA shells';
      const lines = output.split('\n');
      const htmlLine = lines.findIndex((l) => l.includes('page-size-html'));
      const posLine = lines.findIndex((l) => l.includes('content-start-position'));
      expect(lines[htmlLine + 1]).toContain(spaNote);
      expect(lines[posLine + 1]).toContain(spaNote);
    });

    it('does not show SPA caveat when rendering-strategy passes', () => {
      const report = makeReport({
        results: [
          {
            id: 'rendering-strategy',
            category: 'page-size',
            status: 'pass',
            message: 'Server-rendered',
          },
          {
            id: 'page-size-html',
            category: 'page-size',
            status: 'pass',
            message: 'All pages under threshold',
          },
        ],
        summary: { total: 2, pass: 2, warn: 0, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report);
      expect(output).not.toContain('rendering-strategy detected SPA shells');
    });

    it('does not show details without verbose flag', () => {
      const report = makeReport({
        results: [
          {
            id: 'content-start-position',
            category: 'page-size',
            status: 'warn',
            message: 'Issues found',
            details: {
              pageResults: [
                { url: 'https://example.com/page1', contentStartPercent: 42, status: 'warn' },
              ],
            },
          },
        ],
        summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
      });
      const output = formatText(report);
      expect(output).not.toContain('https://example.com/page1');
    });
  });
});

describe('formatText with fixes', () => {
  it('shows Fix: lines for warn/fail checks', () => {
    const report = makeReport({
      results: [
        {
          id: 'llms-txt-exists',
          category: 'content-discoverability',
          status: 'fail',
          message: 'Not found',
        },
        {
          id: 'llms-txt-valid',
          category: 'content-discoverability',
          status: 'pass',
          message: 'OK',
        },
      ],
      summary: { total: 2, pass: 1, warn: 0, fail: 1, skip: 0, error: 0 },
    });
    const output = formatText(report, { fixes: true });
    expect(output).toContain('Fix:');
    expect(output).toContain('Create an llms.txt file');
  });

  it('does not show Fix: for passing checks', () => {
    const report = makeReport({
      results: [
        {
          id: 'llms-txt-exists',
          category: 'content-discoverability',
          status: 'pass',
          message: 'Found',
        },
      ],
      summary: { total: 1, pass: 1, warn: 0, fail: 0, skip: 0, error: 0 },
    });
    const output = formatText(report, { fixes: true });
    expect(output).not.toContain('Fix:');
  });

  it('does not show Fix: lines without fixes flag', () => {
    const report = makeReport({
      results: [
        {
          id: 'llms-txt-exists',
          category: 'content-discoverability',
          status: 'fail',
          message: 'Not found',
        },
      ],
      summary: { total: 1, pass: 0, warn: 0, fail: 1, skip: 0, error: 0 },
    });
    const output = formatText(report);
    expect(output).not.toContain('Fix:');
  });

  it('shows Fix: for warn checks', () => {
    const report = makeReport({
      results: [
        {
          id: 'llms-txt-valid',
          category: 'content-discoverability',
          status: 'warn',
          message: 'Non-standard structure',
        },
      ],
      summary: { total: 1, pass: 0, warn: 1, fail: 0, skip: 0, error: 0 },
    });
    const output = formatText(report, { fixes: true });
    expect(output).toContain('Fix:');
    expect(output).toContain('parseable links');
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

  it('does not include scoring by default', () => {
    const output = formatJson(makeReport());
    const parsed = JSON.parse(output);
    expect(parsed.scoring).toBeUndefined();
  });

  it('includes scoring when score option is true', () => {
    const report = makeReport({
      results: [
        {
          id: 'llms-txt-exists',
          category: 'content-discoverability',
          status: 'pass',
          message: 'Found',
        },
      ],
      summary: { total: 1, pass: 1, warn: 0, fail: 0, skip: 0, error: 0 },
    });
    const output = formatJson(report, { score: true });
    const parsed = JSON.parse(output);
    expect(parsed.scoring).toBeDefined();
    expect(parsed.scoring.overall).toBeTypeOf('number');
    expect(parsed.scoring.grade).toBeTypeOf('string');
    expect(parsed.scoring.categoryScores).toBeDefined();
    expect(parsed.scoring.checkScores).toBeDefined();
    expect(parsed.scoring.diagnostics).toBeInstanceOf(Array);
    expect(parsed.scoring.resolutions).toBeDefined();
  });

  it('preserves report fields alongside scoring', () => {
    const report = makeReport({
      results: [
        {
          id: 'llms-txt-exists',
          category: 'content-discoverability',
          status: 'pass',
          message: 'Found',
        },
      ],
      summary: { total: 1, pass: 1, warn: 0, fail: 0, skip: 0, error: 0 },
    });
    const output = formatJson(report, { score: true });
    const parsed = JSON.parse(output);
    expect(parsed.url).toBe('http://example.com');
    expect(parsed.results).toHaveLength(1);
    expect(parsed.scoring).toBeDefined();
  });
});
