import { describe, it, expect } from 'vitest';
import { getResolution } from '../../../src/scoring/resolutions.js';
import type { CheckResult } from '../../../src/types.js';

function r(
  id: string,
  status: CheckResult['status'],
  details?: Record<string, unknown>,
): CheckResult {
  return { id, category: 'test', status, message: '', details };
}

describe('resolutions', () => {
  it('returns undefined for pass status', () => {
    expect(getResolution(r('llms-txt-exists', 'pass'))).toBeUndefined();
  });

  it('returns undefined for skip status', () => {
    expect(getResolution(r('llms-txt-exists', 'skip'))).toBeUndefined();
  });

  it('returns undefined for unknown check ID', () => {
    expect(getResolution(r('unknown-check', 'fail'))).toBeUndefined();
  });

  it('returns warn text for llms-txt-exists warn', () => {
    const text = getResolution(r('llms-txt-exists', 'warn'));
    expect(text).toContain('cross-host redirect');
  });

  it('returns fail text for llms-txt-exists fail', () => {
    const text = getResolution(r('llms-txt-exists', 'fail'));
    expect(text).toContain('Create an llms.txt');
  });

  it('interpolates size details for llms-txt-size', () => {
    const text = getResolution(
      r('llms-txt-size', 'fail', {
        sizes: [{ characters: 200_000 }],
      }),
    );
    expect(text).toContain('200,000');
    expect(text).toContain('truncated');
  });

  it('interpolates broken link counts', () => {
    const text = getResolution(
      r('llms-txt-links-resolve', 'warn', {
        testedLinks: 20,
        broken: [{ url: '/a' }, { url: '/b' }],
      }),
    );
    expect(text).toContain('2 of 20');
  });

  it('interpolates page counts for page-size-html', () => {
    const text = getResolution(
      r('page-size-html', 'fail', {
        failBucket: 8,
        testedPages: 50,
      }),
    );
    expect(text).toContain('8 of 50');
  });

  it('provides resolution for every check with warn/fail', () => {
    const checkIds = [
      'llms-txt-exists',
      'llms-txt-valid',
      'llms-txt-size',
      'llms-txt-links-resolve',
      'llms-txt-links-markdown',
      'llms-txt-directive',
      'markdown-url-support',
      'content-negotiation',
      'rendering-strategy',
      'page-size-markdown',
      'page-size-html',
      'content-start-position',
      'tabbed-content-serialization',
      'section-header-quality',
      'markdown-code-fence-validity',
      'http-status-codes',
      'redirect-behavior',
      'llms-txt-coverage',
      'markdown-content-parity',
      'cache-header-hygiene',
      'auth-gate-detection',
      'auth-alternative-access',
    ];

    for (const id of checkIds) {
      // At least one of warn or fail should produce text
      const warnText = getResolution(
        r(id, 'warn', {
          failBucket: 1,
          warnBucket: 1,
          testedPages: 10,
          sizes: [{ characters: 80_000 }],
          tabbedPages: [{ status: 'warn' }],
          broken: [{ url: '/x' }],
          testedLinks: 5,
          crossHostCount: 3,
          jsRedirectCount: 2,
          missingCount: 5,
          unclosedCount: 2,
          avgMissingPercent: 15,
          pageResults: [{ status: 'warn' }],
        }),
      );
      const failText = getResolution(
        r(id, 'fail', {
          failBucket: 1,
          warnBucket: 0,
          testedPages: 10,
          spaShells: 5,
          sparseContent: 2,
          sizes: [{ characters: 200_000 }],
          tabbedPages: [{ status: 'fail' }],
          broken: [{ url: '/x' }],
          testedLinks: 5,
          crossHostCount: 3,
          jsRedirectCount: 2,
          missingCount: 5,
          unclosedCount: 2,
          avgMissingPercent: 30,
          pageResults: [{ status: 'fail' }],
        }),
      );
      expect(warnText || failText, `Missing resolution for ${id}`).toBeTruthy();
    }
  });
});
