import { describe, it, expect } from 'vitest';
import { evaluateDiagnostics } from '../../../src/scoring/diagnostics.js';
import type { CheckResult, ReportResult } from '../../../src/types.js';

function r(
  id: string,
  status: CheckResult['status'],
  details?: Record<string, unknown>,
): CheckResult {
  return { id, category: 'test', status, message: '', details };
}

function resultsMap(...results: CheckResult[]): Map<string, CheckResult> {
  return new Map(results.map((res) => [res.id, res]));
}

function defaultReport(): ReportResult {
  return {
    url: 'https://example.com',
    timestamp: new Date().toISOString(),
    specUrl: 'https://agentdocsspec.com/spec/',
    results: [],
    summary: { total: 0, pass: 0, warn: 0, fail: 0, skip: 0, error: 0 },
    samplingStrategy: 'random',
    testedPages: 10,
  };
}

describe('diagnostics', () => {
  describe('markdown-undiscoverable', () => {
    it('triggers when markdown supported but no directive and no content negotiation', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeDefined();
    });

    it('does not trigger when directive-html passes', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'pass'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeUndefined();
    });

    it('does not trigger when content-negotiation passes (partially-discoverable fires instead)', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'pass'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeUndefined();
      expect(diags.find((d) => d.id === 'markdown-partially-discoverable')).toBeDefined();
    });

    it('does not trigger when markdown-url-support fails', () => {
      const results = resultsMap(
        r('markdown-url-support', 'fail'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeUndefined();
    });
  });

  describe('markdown-partially-discoverable', () => {
    it('triggers when content negotiation passes but no HTML directive', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'pass'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'markdown-partially-discoverable');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('warning');
    });

    it('does not trigger when HTML directive passes', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'pass'),
        r('llms-txt-directive-html', 'pass'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'markdown-partially-discoverable')).toBeUndefined();
    });

    it('does not trigger when content negotiation fails (undiscoverable fires instead)', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'markdown-partially-discoverable')).toBeUndefined();
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeDefined();
    });
  });

  describe('truncated-index', () => {
    it('triggers when llms.txt exists but is too large', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'pass'),
        r('llms-txt-size', 'fail', {
          sizes: [{ characters: 250_000 }],
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'truncated-index');
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('250,000');
      expect(diag!.message).toContain('40%');
    });

    it('does not trigger when llms.txt is absent', () => {
      const results = resultsMap(r('llms-txt-exists', 'fail'), r('llms-txt-size', 'fail'));
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'truncated-index')).toBeUndefined();
    });
  });

  describe('spa-shell-html-invalid', () => {
    it('triggers when >25% of pages are SPA shells', () => {
      const results = resultsMap(
        r('rendering-strategy', 'fail', {
          serverRendered: 5,
          sparseContent: 0,
          spaShells: 15,
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'spa-shell-html-invalid')).toBeDefined();
    });

    it('does not trigger when rendering-strategy passes', () => {
      const results = resultsMap(
        r('rendering-strategy', 'pass', {
          serverRendered: 20,
          sparseContent: 0,
          spaShells: 0,
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'spa-shell-html-invalid')).toBeUndefined();
    });

    it('includes markdown note when available', () => {
      const results = resultsMap(
        r('rendering-strategy', 'fail', {
          serverRendered: 5,
          sparseContent: 0,
          spaShells: 15,
        }),
        r('markdown-url-support', 'pass'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'spa-shell-html-invalid');
      expect(diag!.message).toContain('markdown path still works');
    });
  });

  describe('no-viable-path', () => {
    it('triggers when no llms.txt, no rendering, and markdown undiscoverable', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'fail'),
        r('rendering-strategy', 'fail', {
          serverRendered: 0,
          sparseContent: 0,
          spaShells: 20,
        }),
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
        r('llms-txt-directive-md', 'fail'),
        r('llms-txt-links-markdown', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeDefined();
      expect(diags.find((d) => d.id === 'no-viable-path')!.severity).toBe('critical');
    });

    it('triggers when markdown-url-support fails', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'fail'),
        r('rendering-strategy', 'fail'),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeDefined();
    });

    it('does not trigger when llms-txt-exists passes and links resolve', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'pass'),
        r('llms-txt-links-resolve', 'pass', { resolveRate: 100 }),
        r('rendering-strategy', 'fail'),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeUndefined();
    });

    it('triggers when llms.txt exists but links are broken (<10% resolve)', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'pass'),
        r('llms-txt-links-resolve', 'fail', { resolveRate: 0 }),
        r('rendering-strategy', 'fail', {
          serverRendered: 0,
          sparseContent: 0,
          spaShells: 20,
        }),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'no-viable-path');
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('0% of links resolve');
    });

    it('triggers when markdown is only partially discoverable', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'fail'),
        r('rendering-strategy', 'fail', {
          serverRendered: 0,
          sparseContent: 0,
          spaShells: 20,
        }),
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'pass'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'markdown-partially-discoverable')).toBeDefined();
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeDefined();
    });

    it('does not trigger when llms.txt links resolve at 10%+', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'pass'),
        r('llms-txt-links-resolve', 'fail', { resolveRate: 15 }),
        r('rendering-strategy', 'fail'),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeUndefined();
    });
  });

  describe('auth-no-alternative', () => {
    it('triggers when both auth checks fail', () => {
      const results = resultsMap(
        r('auth-gate-detection', 'fail'),
        r('auth-alternative-access', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'auth-no-alternative');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('critical');
    });

    it('does not trigger when alternative access exists', () => {
      const results = resultsMap(
        r('auth-gate-detection', 'fail'),
        r('auth-alternative-access', 'pass'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'auth-no-alternative')).toBeUndefined();
    });
  });

  describe('page-size-no-markdown-escape', () => {
    it('triggers when HTML pages too big and no markdown path', () => {
      const results = resultsMap(
        r('page-size-html', 'fail', { failBucket: 12 }),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'page-size-no-markdown-escape');
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('12 pages');
    });

    it('triggers when markdown is undiscoverable', () => {
      const results = resultsMap(
        r('page-size-html', 'fail', { failBucket: 5 }),
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
        r('llms-txt-directive-md', 'fail'),
        r('llms-txt-links-markdown', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'page-size-no-markdown-escape')).toBeDefined();
    });

    it('triggers when markdown is only partially discoverable (content negotiation but no directive)', () => {
      const results = resultsMap(
        r('page-size-html', 'fail', { failBucket: 5 }),
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'pass'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'page-size-no-markdown-escape')).toBeDefined();
    });

    it('does not trigger when markdown is discoverable via directive', () => {
      const results = resultsMap(
        r('page-size-html', 'fail', { failBucket: 5 }),
        r('markdown-url-support', 'pass'),
        r('llms-txt-directive-html', 'pass'),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'page-size-no-markdown-escape')).toBeUndefined();
    });
  });

  // --- New diagnostics ---

  describe('single-page-sample', () => {
    it('triggers when testedPages is 1 and strategy is discovery-based', () => {
      const report = { ...defaultReport(), testedPages: 1, samplingStrategy: 'random' as const };
      const diags = evaluateDiagnostics(resultsMap(), report);
      const diag = diags.find((d) => d.id === 'single-page-sample');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('warning');
    });

    it('triggers with deterministic sampling', () => {
      const report = {
        ...defaultReport(),
        testedPages: 1,
        samplingStrategy: 'deterministic' as const,
      };
      const diags = evaluateDiagnostics(resultsMap(), report);
      expect(diags.find((d) => d.id === 'single-page-sample')).toBeDefined();
    });

    it('does not trigger with curated sampling', () => {
      const report = { ...defaultReport(), testedPages: 1, samplingStrategy: 'curated' as const };
      const diags = evaluateDiagnostics(resultsMap(), report);
      expect(diags.find((d) => d.id === 'single-page-sample')).toBeUndefined();
    });

    it('does not trigger with none sampling', () => {
      const report = { ...defaultReport(), testedPages: 1, samplingStrategy: 'none' as const };
      const diags = evaluateDiagnostics(resultsMap(), report);
      expect(diags.find((d) => d.id === 'single-page-sample')).toBeUndefined();
    });

    it('does not trigger when testedPages >= threshold', () => {
      const report = { ...defaultReport(), testedPages: 5, samplingStrategy: 'random' as const };
      const diags = evaluateDiagnostics(resultsMap(), report);
      expect(diags.find((d) => d.id === 'single-page-sample')).toBeUndefined();
    });

    it('triggers when testedPages is below threshold but above 1', () => {
      const report = { ...defaultReport(), testedPages: 3, samplingStrategy: 'random' as const };
      const diags = evaluateDiagnostics(resultsMap(), report);
      const diag = diags.find((d) => d.id === 'single-page-sample');
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('3 pages were');
      expect(diag!.message).toContain('minimum 5');
    });

    it('does not trigger when testedPages is undefined', () => {
      const report = { ...defaultReport(), testedPages: undefined };
      const diags = evaluateDiagnostics(resultsMap(), report);
      expect(diags.find((d) => d.id === 'single-page-sample')).toBeUndefined();
    });
  });

  describe('cross-origin-llms-txt', () => {
    it('triggers when all links are cross-origin', () => {
      const results = resultsMap(
        r('llms-txt-links-resolve', 'warn', {
          sameOrigin: { total: 0 },
          crossOrigin: { total: 15, dominantOrigin: 'https://docs.example.com' },
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'cross-origin-llms-txt');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('warning');
      expect(diag!.message).toContain('15 links');
      expect(diag!.message).toContain('https://docs.example.com');
    });

    it('does not trigger when there are same-origin links', () => {
      const results = resultsMap(
        r('llms-txt-links-resolve', 'pass', {
          sameOrigin: { total: 10 },
          crossOrigin: { total: 5 },
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'cross-origin-llms-txt')).toBeUndefined();
    });

    it('does not trigger when check is skipped', () => {
      const results = resultsMap(r('llms-txt-links-resolve', 'skip'));
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'cross-origin-llms-txt')).toBeUndefined();
    });

    it('does not trigger when there are no cross-origin links', () => {
      const results = resultsMap(
        r('llms-txt-links-resolve', 'pass', {
          sameOrigin: { total: 0 },
          crossOrigin: { total: 0 },
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'cross-origin-llms-txt')).toBeUndefined();
    });
  });

  describe('gzipped-sitemap-skipped', () => {
    it('triggers when a check has a gzipped sitemap warning', () => {
      const results = resultsMap(
        r('page-size-html', 'pass', {
          discoveryWarnings: [
            'Skipped gzipped sitemap (not supported): https://example.com/sitemap.xml.gz',
          ],
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'gzipped-sitemap-skipped');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('info');
      expect(diag!.message).toContain('sitemap.xml.gz');
    });

    it('does not trigger without gzipped sitemap warnings', () => {
      const results = resultsMap(
        r('page-size-html', 'pass', {
          discoveryWarnings: ['Some other warning'],
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'gzipped-sitemap-skipped')).toBeUndefined();
    });

    it('does not trigger with no discovery warnings', () => {
      const results = resultsMap(r('page-size-html', 'pass'));
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'gzipped-sitemap-skipped')).toBeUndefined();
    });
  });

  describe('rate-limiting-severe', () => {
    it('triggers when >20% of requests are rate-limited', () => {
      const results = resultsMap(
        r('llms-txt-links-resolve', 'warn', {
          testedLinks: 50,
          rateLimited: 15,
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      const diag = diags.find((d) => d.id === 'rate-limiting-severe');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('warning');
      expect(diag!.message).toContain('30%');
    });

    it('does not trigger when rate limiting is below threshold', () => {
      const results = resultsMap(
        r('llms-txt-links-resolve', 'pass', {
          testedLinks: 50,
          rateLimited: 5,
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'rate-limiting-severe')).toBeUndefined();
    });

    it('aggregates rate limiting across multiple checks', () => {
      const results = resultsMap(
        r('llms-txt-links-resolve', 'pass', {
          testedLinks: 50,
          rateLimited: 5,
        }),
        r('markdown-url-support', 'warn', {
          pageResults: Array.from({ length: 10 }, () => ({})),
          rateLimited: 8,
        }),
      );
      const diags = evaluateDiagnostics(results, defaultReport());
      // 13/60 = 21.7% -> triggers
      expect(diags.find((d) => d.id === 'rate-limiting-severe')).toBeDefined();
    });

    it('does not trigger when no checks have rate limiting data', () => {
      const results = resultsMap(r('page-size-html', 'pass'));
      const diags = evaluateDiagnostics(results, defaultReport());
      expect(diags.find((d) => d.id === 'rate-limiting-severe')).toBeUndefined();
    });
  });
});
