import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createContext, normalizeUrl, runChecks } from '../../src/runner.js';
import { registerCheck } from '../../src/checks/registry.js';
import '../../src/checks/index.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('normalizeUrl', () => {
  it('prepends https:// to bare domains', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('prepends https:// to domains with paths', () => {
    expect(normalizeUrl('docs.example.com/api')).toBe('https://docs.example.com/api');
  });

  it('leaves https:// URLs unchanged', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('leaves http:// URLs unchanged', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('is case-insensitive for scheme detection', () => {
    expect(normalizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
    expect(normalizeUrl('Http://example.com')).toBe('Http://example.com');
  });
});

describe('createContext URL normalization', () => {
  it('prepends https:// when no scheme is provided', () => {
    const ctx = createContext('example.com');
    expect(ctx.baseUrl).toBe('https://example.com');
    expect(ctx.origin).toBe('https://example.com');
  });

  it('prepends https:// for bare domain with path', () => {
    const ctx = createContext('docs.example.com/api');
    expect(ctx.baseUrl).toBe('https://docs.example.com/api');
    expect(ctx.origin).toBe('https://docs.example.com');
  });

  it('leaves https:// URLs unchanged', () => {
    const ctx = createContext('https://example.com');
    expect(ctx.baseUrl).toBe('https://example.com');
  });

  it('leaves http:// URLs unchanged', () => {
    const ctx = createContext('http://example.com');
    expect(ctx.baseUrl).toBe('http://example.com');
  });

  it('strips trailing slash after normalization', () => {
    const ctx = createContext('example.com/');
    expect(ctx.baseUrl).toBe('https://example.com');
  });
});

describe('runner', () => {
  it('skips dependent checks when dependency fails', async () => {
    server.use(
      http.get('http://nodeps.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get('http://nodeps.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://nodeps.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid', 'llms-txt-size'],
      requestDelay: 0,
    });

    expect(report.results[0].id).toBe('llms-txt-exists');
    expect(report.results[0].status).toBe('fail');

    // Dependent checks should be skipped
    expect(report.results[1].id).toBe('llms-txt-valid');
    expect(report.results[1].status).toBe('skip');
    expect(report.results[2].id).toBe('llms-txt-size');
    expect(report.results[2].status).toBe('skip');
  });

  it('runs dependent checks when dependency passes', async () => {
    const content = `# Test\n\n> Summary.\n\n## Links\n\n- [A](http://deps.local/a): A\n`;
    server.use(
      http.get('http://deps.local/llms.txt', () => HttpResponse.text(content)),
      http.get('http://deps.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://deps.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid', 'llms-txt-size'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('pass');
    expect(report.results[1].status).toBe('pass');
    expect(report.results[2].status).toBe('pass');
  });

  it('produces correct summary counts', async () => {
    server.use(
      http.get('http://summary.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get('http://summary.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://summary.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid'],
      requestDelay: 0,
    });

    expect(report.summary.fail).toBe(1);
    expect(report.summary.skip).toBe(1);
    expect(report.summary.total).toBe(2);
  });

  it('auth-alternative-access skips when auth-gate-detection did not run', async () => {
    const report = await runChecks('http://stub.local', {
      checkIds: ['auth-alternative-access'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('skip');
    expect(report.results[0].message).toBe('auth-gate-detection did not run');
  });

  it('catches check errors and reports status "error"', async () => {
    registerCheck({
      id: '_test-throws',
      category: 'content-discoverability',
      description: 'Test check that throws',
      dependsOn: [],
      run: () => {
        throw new Error('Boom');
      },
    });

    const report = await runChecks('http://throws.local', {
      checkIds: ['_test-throws'],
      requestDelay: 0,
    });

    expect(report.results).toHaveLength(1);
    expect(report.results[0].id).toBe('_test-throws');
    expect(report.results[0].status).toBe('error');
    expect(report.results[0].message).toContain('Boom');
  });

  it('catches non-Error thrown values', async () => {
    registerCheck({
      id: '_test-throws-string',
      category: 'content-discoverability',
      description: 'Test check that throws a string',
      dependsOn: [],
      run: () => {
        throw 'string error';
      },
    });

    const report = await runChecks('http://throws-str.local', {
      checkIds: ['_test-throws-string'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('error');
    expect(report.results[0].message).toContain('string error');
  });

  it('lets check run in standalone mode when dependencies were not executed', async () => {
    // page-size-markdown depends on [['markdown-url-support', 'content-negotiation']]
    // When neither dependency runs (filtered out), page-size-markdown should still run
    // rather than being skipped.
    server.use(
      http.get('http://standalone.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get(
        'http://standalone.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get('http://standalone.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://standalone.local/sitemap.xml', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://standalone.local',
        () =>
          new HttpResponse('<!DOCTYPE html><html><body>Home</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get('http://standalone.local.md', () => new HttpResponse('Not found', { status: 404 })),
      http.get(
        'http://standalone.local/index.md',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
    );

    const report = await runChecks('http://standalone.local', {
      checkIds: ['page-size-markdown'],
      requestDelay: 0,
    });

    // Should NOT be 'skip' with "dependency check did not pass"
    expect(report.results).toHaveLength(1);
    expect(report.results[0].id).toBe('page-size-markdown');
    expect(report.results[0].message).not.toContain('dependency check did not pass');
  });

  it('skips check with OR-group deps when the dep that ran failed', async () => {
    // Register test checks to control the OR-group scenario precisely
    registerCheck({
      id: '_test-dep-a',
      category: 'content-discoverability',
      description: 'Dep A',
      dependsOn: [],
      run: async () => ({
        id: '_test-dep-a',
        category: 'content-discoverability',
        status: 'fail',
        message: 'Failed',
      }),
    });
    registerCheck({
      id: '_test-or-child',
      category: 'content-discoverability',
      description: 'Child with OR dep',
      dependsOn: [['_test-dep-a', '_test-dep-b']],
      run: async () => ({
        id: '_test-or-child',
        category: 'content-discoverability',
        status: 'pass',
        message: 'OK',
      }),
    });

    // Only dep-a runs (dep-b not in checkIds so never runs), and dep-a fails.
    // Since dep-a ran and failed, and dep-b didn't run, the OR-group has at least
    // one dep that ran and none passed → skip.
    const report = await runChecks('http://or-skip.local', {
      checkIds: ['_test-dep-a', '_test-or-child'],
      requestDelay: 0,
    });

    const child = report.results.find((r) => r.id === '_test-or-child');
    expect(child?.status).toBe('skip');
    expect(child?.message).toContain('dependency check did not pass');
  });

  it('runs check when OR-group dep passes', async () => {
    registerCheck({
      id: '_test-dep-pass',
      category: 'content-discoverability',
      description: 'Dep that passes',
      dependsOn: [],
      run: async () => ({
        id: '_test-dep-pass',
        category: 'content-discoverability',
        status: 'pass',
        message: 'OK',
      }),
    });
    registerCheck({
      id: '_test-or-passes',
      category: 'content-discoverability',
      description: 'Child with OR dep that passes',
      dependsOn: [['_test-dep-pass', '_test-dep-never']],
      run: async () => ({
        id: '_test-or-passes',
        category: 'content-discoverability',
        status: 'pass',
        message: 'OK',
      }),
    });

    const report = await runChecks('http://or-pass.local', {
      checkIds: ['_test-dep-pass', '_test-or-passes'],
      requestDelay: 0,
    });

    const child = report.results.find((r) => r.id === '_test-or-passes');
    expect(child?.status).toBe('pass');
  });

  it('includes timestamp and url in report', async () => {
    const report = await runChecks('http://meta.local', {
      checkIds: ['tabbed-content-serialization'],
      requestDelay: 0,
    });

    expect(report.url).toBe('http://meta.local');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
