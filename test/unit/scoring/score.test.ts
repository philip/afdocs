import { describe, it, expect } from 'vitest';
import { computeScore, toGrade } from '../../../src/scoring/score.js';
import type { CheckResult, ReportResult } from '../../../src/types.js';

function makeResult(
  id: string,
  category: string,
  status: CheckResult['status'],
  details?: Record<string, unknown>,
): CheckResult {
  return { id, category, status, message: `${id}: ${status}`, details };
}

function makeReport(results: CheckResult[]): ReportResult {
  const summary = { total: results.length, pass: 0, warn: 0, fail: 0, skip: 0, error: 0 };
  for (const r of results) {
    summary[r.status]++;
  }
  return {
    url: 'https://example.com',
    timestamp: new Date().toISOString(),
    specUrl: 'https://agentdocsspec.com/spec/',
    results,
    summary,
  };
}

describe('toGrade', () => {
  it('assigns correct grades', () => {
    expect(toGrade(100)).toBe('A+');
    expect(toGrade(99)).toBe('A');
    expect(toGrade(90)).toBe('A');
    expect(toGrade(89)).toBe('B');
    expect(toGrade(80)).toBe('B');
    expect(toGrade(79)).toBe('C');
    expect(toGrade(70)).toBe('C');
    expect(toGrade(69)).toBe('D');
    expect(toGrade(60)).toBe('D');
    expect(toGrade(59)).toBe('F');
    expect(toGrade(0)).toBe('F');
  });
});

describe('computeScore', () => {
  it('scores a perfect report as 100 (A+)', () => {
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'pass'),
      makeResult('llms-txt-valid', 'content-discoverability', 'pass'),
      makeResult('llms-txt-size', 'content-discoverability', 'pass'),
      makeResult('llms-txt-links-resolve', 'content-discoverability', 'pass'),
      makeResult('llms-txt-links-markdown', 'content-discoverability', 'pass'),
      makeResult('llms-txt-directive', 'content-discoverability', 'pass'),
      makeResult('markdown-url-support', 'markdown-availability', 'pass'),
      makeResult('content-negotiation', 'markdown-availability', 'pass'),
      makeResult('rendering-strategy', 'page-size', 'pass', {
        serverRendered: 50,
        sparseContent: 0,
        spaShells: 0,
      }),
      makeResult('page-size-markdown', 'page-size', 'pass'),
      makeResult('page-size-html', 'page-size', 'pass'),
      makeResult('content-start-position', 'page-size', 'pass'),
      makeResult('tabbed-content-serialization', 'content-structure', 'pass'),
      makeResult('section-header-quality', 'content-structure', 'pass'),
      makeResult('markdown-code-fence-validity', 'content-structure', 'pass'),
      makeResult('http-status-codes', 'url-stability', 'pass'),
      makeResult('redirect-behavior', 'url-stability', 'pass'),
      makeResult('llms-txt-coverage', 'observability', 'pass'),
      makeResult('markdown-content-parity', 'observability', 'pass'),
      makeResult('cache-header-hygiene', 'observability', 'pass'),
      makeResult('auth-gate-detection', 'authentication', 'pass'),
      makeResult('auth-alternative-access', 'authentication', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.overall).toBe(100);
    expect(score.grade).toBe('A+');
    expect(score.cap).toBeUndefined();
    expect(score.diagnostics).toHaveLength(0);
  });

  it('scores an all-fail report as 0 (F)', () => {
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'fail'),
      makeResult('rendering-strategy', 'page-size', 'fail', {
        serverRendered: 0,
        sparseContent: 0,
        spaShells: 50,
      }),
      makeResult('auth-gate-detection', 'authentication', 'fail', {
        pageResults: Array.from({ length: 50 }, (_, i) => ({
          url: `/page-${i}`,
          classification: 'auth-required',
        })),
      }),
      makeResult('page-size-html', 'page-size', 'fail', {
        passBucket: 0,
        warnBucket: 0,
        failBucket: 50,
      }),
      makeResult('markdown-url-support', 'markdown-availability', 'fail'),
      makeResult('http-status-codes', 'url-stability', 'fail'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.overall).toBe(0);
    expect(score.grade).toBe('F');
  });

  it('excludes skipped checks from scoring', () => {
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'pass'),
      makeResult('llms-txt-valid', 'content-discoverability', 'skip'),
      makeResult('llms-txt-size', 'content-discoverability', 'skip'),
    ];
    const score = computeScore(makeReport(results));
    // Only llms-txt-exists counted: 10/10 = 100
    expect(score.overall).toBe(100);
    expect(score.checkScores['llms-txt-valid']).toBeUndefined();
  });

  it('applies critical check cap for llms-txt-exists fail', () => {
    // Even with everything else perfect, missing llms.txt caps at 59
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'fail'),
      makeResult('rendering-strategy', 'page-size', 'pass', {
        serverRendered: 50,
        sparseContent: 0,
        spaShells: 0,
      }),
      makeResult('markdown-url-support', 'markdown-availability', 'pass'),
      makeResult('content-negotiation', 'markdown-availability', 'pass'),
      makeResult('page-size-html', 'page-size', 'pass'),
      makeResult('page-size-markdown', 'page-size', 'pass'),
      makeResult('http-status-codes', 'url-stability', 'pass'),
      makeResult('auth-gate-detection', 'authentication', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.overall).toBeLessThanOrEqual(59);
    expect(score.cap).toBeDefined();
    expect(score.cap!.checkId).toBe('llms-txt-exists');
  });

  it('applies rendering-strategy cap when 75%+ pages are SPA shells', () => {
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'pass'),
      makeResult('rendering-strategy', 'page-size', 'fail', {
        serverRendered: 5,
        sparseContent: 0,
        spaShells: 45,
      }),
      makeResult('page-size-html', 'page-size', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    // rendering-strategy proportion: 5/50 = 0.1, which is <=0.25 -> cap at 39
    expect(score.overall).toBeLessThanOrEqual(39);
    expect(score.cap).toBeDefined();
    expect(score.cap!.cap).toBe(39);
  });

  it('applies lowest cap when multiple apply', () => {
    // Include enough passing checks so the raw score is above the cap
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'fail'),
      makeResult('rendering-strategy', 'page-size', 'fail', {
        serverRendered: 2,
        sparseContent: 0,
        spaShells: 48,
      }),
      makeResult('markdown-url-support', 'markdown-availability', 'pass'),
      makeResult('content-negotiation', 'markdown-availability', 'pass'),
      makeResult('page-size-html', 'page-size', 'pass'),
      makeResult('page-size-markdown', 'page-size', 'pass'),
      makeResult('http-status-codes', 'url-stability', 'pass'),
      makeResult('redirect-behavior', 'url-stability', 'pass'),
      makeResult('auth-gate-detection', 'authentication', 'pass'),
      makeResult('auth-alternative-access', 'authentication', 'pass'),
      makeResult('cache-header-hygiene', 'observability', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    // llms-txt-exists fail -> cap 59
    // rendering-strategy 2/50 = 0.04 -> cap 39
    // Lowest wins: 39
    expect(score.cap).toBeDefined();
    expect(score.cap!.cap).toBe(39);
    expect(score.overall).toBeLessThanOrEqual(39);
  });

  it('applies no-viable-path cap at 39', () => {
    // No llms.txt, rendering not run, no markdown -> no-viable-path fires
    // Use skip for rendering-strategy so only no-viable-path and llms-txt-exists caps apply
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'fail'),
      makeResult('rendering-strategy', 'page-size', 'skip'),
      makeResult('markdown-url-support', 'markdown-availability', 'fail'),
      // Pass some checks so raw score would be above 39
      makeResult('http-status-codes', 'url-stability', 'pass'),
      makeResult('redirect-behavior', 'url-stability', 'pass'),
      makeResult('auth-gate-detection', 'authentication', 'pass'),
      makeResult('auth-alternative-access', 'authentication', 'pass'),
      makeResult('cache-header-hygiene', 'observability', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.diagnostics.find((d) => d.id === 'no-viable-path')).toBeDefined();
    expect(score.cap).toBeDefined();
    // no-viable-path cap (39) beats llms-txt-exists cap (59)
    expect(score.cap!.cap).toBe(39);
    expect(score.cap!.checkId).toBe('no-viable-path');
    expect(score.overall).toBeLessThanOrEqual(39);
  });

  it('does not apply cap when score is already below cap', () => {
    // All-fail scenario: raw score is 0, cap at 59 wouldn't reduce it
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'fail'),
      makeResult('rendering-strategy', 'page-size', 'fail', {
        serverRendered: 0,
        sparseContent: 0,
        spaShells: 50,
      }),
    ];
    const score = computeScore(makeReport(results));
    expect(score.overall).toBe(0);
    // Cap computed but not applied since score is already below
    expect(score.cap).toBeUndefined();
  });

  it('applies discovery coefficient correctly', () => {
    // page-size-markdown should get coefficient 0.0 when markdown
    // is not discoverable
    const results: CheckResult[] = [
      makeResult('content-negotiation', 'markdown-availability', 'fail'),
      makeResult('llms-txt-directive', 'content-discoverability', 'fail'),
      makeResult('llms-txt-links-markdown', 'content-discoverability', 'fail'),
      makeResult('page-size-markdown', 'page-size', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    // page-size-markdown should have coefficient 0, so its earned and max are both 0
    expect(score.checkScores['page-size-markdown'].coefficient).toBe(0);
    expect(score.checkScores['page-size-markdown'].effectiveWeight).toBe(0);
    expect(score.checkScores['page-size-markdown'].earnedScore).toBe(0);
  });

  it('computes proportional scores for multi-page checks', () => {
    const results: CheckResult[] = [
      makeResult('page-size-html', 'page-size', 'warn', {
        passBucket: 47,
        warnBucket: 3,
        failBucket: 0,
      }),
    ];
    const score = computeScore(makeReport(results));
    const cs = score.checkScores['page-size-html'];
    // proportion: (47 + 3*0.5) / 50 = 0.97
    expect(cs.proportion).toBeCloseTo(0.97);
    expect(cs.baseWeight).toBe(7);
  });

  it('includes category scores', () => {
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'pass'),
      makeResult('llms-txt-valid', 'content-discoverability', 'pass'),
      makeResult('http-status-codes', 'url-stability', 'fail'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.categoryScores['content-discoverability'].score).toBe(100);
    expect(score.categoryScores['url-stability'].score).toBe(0);
  });

  it('includes resolutions for warn/fail checks', () => {
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'fail'),
      makeResult('http-status-codes', 'url-stability', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.resolutions['llms-txt-exists']).toContain('Create an llms.txt');
    expect(score.resolutions['http-status-codes']).toBeUndefined();
  });

  it('includes diagnostics when conditions are met', () => {
    const results: CheckResult[] = [
      makeResult('markdown-url-support', 'markdown-availability', 'pass'),
      makeResult('content-negotiation', 'markdown-availability', 'fail'),
      makeResult('llms-txt-directive', 'content-discoverability', 'fail'),
      makeResult('llms-txt-links-markdown', 'content-discoverability', 'fail'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.diagnostics.find((d) => d.id === 'markdown-undiscoverable')).toBeDefined();
  });

  it('produces 0 category score when all checks in a category are skipped', () => {
    const results: CheckResult[] = [
      makeResult('llms-txt-exists', 'content-discoverability', 'pass'),
      makeResult('markdown-url-support', 'markdown-availability', 'skip'),
      makeResult('content-negotiation', 'markdown-availability', 'skip'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.categoryScores['markdown-availability'].score).toBe(0);
  });

  it('handles empty report', () => {
    const score = computeScore(makeReport([]));
    expect(score.overall).toBe(0);
    expect(score.grade).toBe('F');
    expect(Object.keys(score.checkScores)).toHaveLength(0);
  });

  it('handles unknown check IDs gracefully', () => {
    const results: CheckResult[] = [
      makeResult('unknown-check', 'unknown', 'pass'),
      makeResult('llms-txt-exists', 'content-discoverability', 'pass'),
    ];
    const score = computeScore(makeReport(results));
    expect(score.checkScores['unknown-check']).toBeUndefined();
    expect(score.checkScores['llms-txt-exists']).toBeDefined();
  });

  describe('index truncation coefficient', () => {
    it('reduces llms-txt-valid weight when llms-txt-size fails', () => {
      const results: CheckResult[] = [
        makeResult('llms-txt-size', 'content-discoverability', 'fail', {
          sizes: [{ characters: 200_000 }],
        }),
        makeResult('llms-txt-valid', 'content-discoverability', 'pass'),
      ];
      const score = computeScore(makeReport(results));
      // Coefficient should be 100K/200K = 0.5
      expect(score.checkScores['llms-txt-valid'].coefficient).toBe(0.5);
      expect(score.checkScores['llms-txt-valid'].effectiveWeight).toBe(2); // 4 * 0.5
    });
  });

  describe('HTML path coefficient', () => {
    it('reduces page-size-html weight when many pages are SPA shells', () => {
      const results: CheckResult[] = [
        makeResult('rendering-strategy', 'page-size', 'fail', {
          serverRendered: 10,
          sparseContent: 0,
          spaShells: 40,
        }),
        makeResult('page-size-html', 'page-size', 'pass'),
      ];
      const score = computeScore(makeReport(results));
      // Coefficient: 10/50 = 0.2
      expect(score.checkScores['page-size-html'].coefficient).toBeCloseTo(0.2);
    });
  });

  describe('realistic scenario', () => {
    it('scores a typical docs site with some issues', () => {
      const results: CheckResult[] = [
        // Good discoverability
        makeResult('llms-txt-exists', 'content-discoverability', 'pass'),
        makeResult('llms-txt-valid', 'content-discoverability', 'pass'),
        makeResult('llms-txt-size', 'content-discoverability', 'pass'),
        makeResult('llms-txt-links-resolve', 'content-discoverability', 'pass'),
        makeResult('llms-txt-links-markdown', 'content-discoverability', 'fail', {
          markdownRate: 0,
          testedLinks: 20,
        }),
        makeResult('llms-txt-directive', 'content-discoverability', 'fail'),

        // No markdown
        makeResult('markdown-url-support', 'markdown-availability', 'fail'),
        makeResult('content-negotiation', 'markdown-availability', 'fail'),

        // Good rendering, some large pages
        makeResult('rendering-strategy', 'page-size', 'pass', {
          serverRendered: 50,
          sparseContent: 0,
          spaShells: 0,
        }),
        makeResult('page-size-html', 'page-size', 'warn', {
          passBucket: 45,
          warnBucket: 5,
          failBucket: 0,
        }),
        makeResult('content-start-position', 'page-size', 'pass'),

        // Clean content
        makeResult('tabbed-content-serialization', 'content-structure', 'pass'),
        makeResult('section-header-quality', 'content-structure', 'pass'),
        makeResult('markdown-code-fence-validity', 'content-structure', 'pass'),

        // Good URL stability
        makeResult('http-status-codes', 'url-stability', 'pass'),
        makeResult('redirect-behavior', 'url-stability', 'pass'),

        // Observability
        makeResult('llms-txt-coverage', 'observability', 'pass'),
        makeResult('cache-header-hygiene', 'observability', 'pass'),

        // No auth issues
        makeResult('auth-gate-detection', 'authentication', 'pass'),
        makeResult('auth-alternative-access', 'authentication', 'pass'),
      ];

      const score = computeScore(makeReport(results));

      // Good score despite no markdown: discovery coefficient zeroes out
      // markdown quality checks (reducing denominator), and most other
      // checks pass. Loses points for no markdown support, no directive,
      // HTML-only links, some large pages.
      expect(score.overall).toBeGreaterThan(60);
      expect(score.overall).toBeLessThan(95);
      expect(score.cap).toBeUndefined();

      // Should have resolutions for failing checks
      expect(score.resolutions['llms-txt-links-markdown']).toBeDefined();
      expect(score.resolutions['llms-txt-directive']).toBeDefined();
      expect(score.resolutions['markdown-url-support']).toBeDefined();
    });
  });

  describe('tag scores integration', () => {
    it('includes tagScores when report has urlTags', () => {
      const results: CheckResult[] = [
        makeResult('page-size-html', 'page-size', 'warn', {
          passBucket: 1,
          warnBucket: 1,
          failBucket: 0,
          pageResults: [
            { url: 'https://example.com/a', status: 'pass' },
            { url: 'https://example.com/b', status: 'warn' },
          ],
        }),
      ];
      const report = makeReport(results);
      report.urlTags = {
        'https://example.com/a': 'docs',
        'https://example.com/b': 'api',
      };

      const score = computeScore(report);
      expect(score.tagScores).toBeDefined();
      expect(score.tagScores!['docs'].score).toBe(100);
      expect(score.tagScores!['api'].score).toBe(50); // warn maps to 0.5
    });

    it('omits tagScores when report has no urlTags', () => {
      const results: CheckResult[] = [
        makeResult('page-size-html', 'page-size', 'pass', {
          passBucket: 1,
          warnBucket: 0,
          failBucket: 0,
          pageResults: [{ url: 'https://example.com/a', status: 'pass' }],
        }),
      ];
      const score = computeScore(makeReport(results));
      expect(score.tagScores).toBeUndefined();
    });
  });
});
