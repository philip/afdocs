import { describe, it, expect } from 'vitest';
import { evaluateDiagnostics } from '../../../src/scoring/diagnostics.js';
import type { CheckResult } from '../../../src/types.js';

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

describe('diagnostics', () => {
  describe('markdown-undiscoverable', () => {
    it('triggers when markdown supported but no directive and no content negotiation', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeDefined();
    });

    it('does not trigger when directive-html passes', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'pass'),
      );
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeUndefined();
    });

    it('does not trigger when content-negotiation passes (partially-discoverable fires instead)', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'pass'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'markdown-undiscoverable')).toBeUndefined();
      expect(diags.find((d) => d.id === 'markdown-partially-discoverable')).toBeDefined();
    });

    it('does not trigger when markdown-url-support fails', () => {
      const results = resultsMap(
        r('markdown-url-support', 'fail'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'markdown-partially-discoverable')).toBeUndefined();
    });

    it('does not trigger when content negotiation fails (undiscoverable fires instead)', () => {
      const results = resultsMap(
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'fail'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
      const diag = diags.find((d) => d.id === 'truncated-index');
      expect(diag).toBeDefined();
      expect(diag!.message).toContain('250,000');
      expect(diag!.message).toContain('40%');
    });

    it('does not trigger when llms.txt is absent', () => {
      const results = resultsMap(r('llms-txt-exists', 'fail'), r('llms-txt-size', 'fail'));
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeDefined();
      expect(diags.find((d) => d.id === 'no-viable-path')!.severity).toBe('critical');
    });

    it('triggers when markdown-url-support fails', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'fail'),
        r('rendering-strategy', 'fail'),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeDefined();
    });

    it('does not trigger when llms-txt-exists passes and links resolve', () => {
      const results = resultsMap(
        r('llms-txt-exists', 'pass'),
        r('llms-txt-links-resolve', 'pass', { resolveRate: 100 }),
        r('rendering-strategy', 'fail'),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'no-viable-path')).toBeUndefined();
    });
  });

  describe('auth-no-alternative', () => {
    it('triggers when both auth checks fail', () => {
      const results = resultsMap(
        r('auth-gate-detection', 'fail'),
        r('auth-alternative-access', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
      const diag = diags.find((d) => d.id === 'auth-no-alternative');
      expect(diag).toBeDefined();
      expect(diag!.severity).toBe('critical');
    });

    it('does not trigger when alternative access exists', () => {
      const results = resultsMap(
        r('auth-gate-detection', 'fail'),
        r('auth-alternative-access', 'pass'),
      );
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'auth-no-alternative')).toBeUndefined();
    });
  });

  describe('page-size-no-markdown-escape', () => {
    it('triggers when HTML pages too big and no markdown path', () => {
      const results = resultsMap(
        r('page-size-html', 'fail', { failBucket: 12 }),
        r('markdown-url-support', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
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
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'page-size-no-markdown-escape')).toBeDefined();
    });

    it('triggers when markdown is only partially discoverable (content negotiation but no directive)', () => {
      const results = resultsMap(
        r('page-size-html', 'fail', { failBucket: 5 }),
        r('markdown-url-support', 'pass'),
        r('content-negotiation', 'pass'),
        r('llms-txt-directive-html', 'fail'),
      );
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'page-size-no-markdown-escape')).toBeDefined();
    });

    it('does not trigger when markdown is discoverable via directive', () => {
      const results = resultsMap(
        r('page-size-html', 'fail', { failBucket: 5 }),
        r('markdown-url-support', 'pass'),
        r('llms-txt-directive-html', 'pass'),
      );
      const diags = evaluateDiagnostics(results);
      expect(diags.find((d) => d.id === 'page-size-no-markdown-escape')).toBeUndefined();
    });
  });
});
