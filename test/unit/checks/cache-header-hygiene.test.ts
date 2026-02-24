import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';
import type { DiscoveredFile } from '../../../src/types.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('cache-header-hygiene', () => {
  const check = getCheck('cache-header-hygiene')!;

  /**
   * Create a context where the llms.txt discoveredFile URL and the
   * page links share the same host, so the check can fetch both without timeouts.
   */
  function makeCtx(host: string, pageUrl: string) {
    const llmsTxtUrl = `http://${host}/llms.txt`;
    const content = `# Docs\n## Links\n- [Page 1](${pageUrl}): First\n`;
    const ctx = createContext(`http://${host}`, { requestDelay: 0 });

    const discovered: DiscoveredFile[] = [
      { url: llmsTxtUrl, content, status: 200, redirected: false },
    ];
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'llms-txt',
      status: 'pass',
      message: 'Found',
      details: { discoveredFiles: discovered },
    });

    return ctx;
  }

  it('passes with short max-age', async () => {
    const cacheHeaders = { 'Cache-Control': 'max-age=300', 'Content-Type': 'text/html' };
    server.use(
      http.get(
        'http://chh-short.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers: cacheHeaders }),
      ),
      http.get(
        'http://chh-short.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers: cacheHeaders }),
      ),
    );

    const result = await check.run(makeCtx('chh-short.local', 'http://chh-short.local/docs/page1'));
    expect(result.status).toBe('pass');
  });

  it('passes with no-cache directive', async () => {
    const cacheHeaders = { 'Cache-Control': 'no-cache', 'Content-Type': 'text/html' };
    server.use(
      http.get(
        'http://chh-nocache.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers: cacheHeaders }),
      ),
      http.get(
        'http://chh-nocache.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers: cacheHeaders }),
      ),
    );

    const result = await check.run(
      makeCtx('chh-nocache.local', 'http://chh-nocache.local/docs/page1'),
    );
    expect(result.status).toBe('pass');
  });

  it('passes with must-revalidate and ETag', async () => {
    const headers = {
      'Cache-Control': 'must-revalidate',
      ETag: '"abc123"',
      'Content-Type': 'text/html',
    };
    server.use(
      http.get(
        'http://chh-etag.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers }),
      ),
      http.get(
        'http://chh-etag.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers }),
      ),
    );

    const result = await check.run(makeCtx('chh-etag.local', 'http://chh-etag.local/docs/page1'));
    expect(result.status).toBe('pass');
  });

  it('warns with moderate max-age (1-24 hours)', async () => {
    const cacheHeaders = { 'Cache-Control': 'max-age=7200', 'Content-Type': 'text/html' };
    server.use(
      http.get(
        'http://chh-moderate.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers: cacheHeaders }),
      ),
      http.get(
        'http://chh-moderate.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers: cacheHeaders }),
      ),
    );

    const result = await check.run(
      makeCtx('chh-moderate.local', 'http://chh-moderate.local/docs/page1'),
    );
    expect(result.status).toBe('warn');
    expect(result.details?.warnBucket).toBeGreaterThanOrEqual(1);
  });

  it('fails with aggressive max-age (>24 hours)', async () => {
    const cacheHeaders = { 'Cache-Control': 'max-age=604800', 'Content-Type': 'text/html' };
    server.use(
      http.get(
        'http://chh-aggressive.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers: cacheHeaders }),
      ),
      http.get(
        'http://chh-aggressive.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers: cacheHeaders }),
      ),
    );

    const result = await check.run(
      makeCtx('chh-aggressive.local', 'http://chh-aggressive.local/docs/page1'),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.failBucket).toBeGreaterThanOrEqual(1);
  });

  it('fails with no cache headers at all', async () => {
    server.use(
      http.get(
        'http://chh-none.local/llms.txt',
        () =>
          new HttpResponse('# Docs', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      ),
      http.get(
        'http://chh-none.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(makeCtx('chh-none.local', 'http://chh-none.local/docs/page1'));
    expect(result.status).toBe('fail');
  });

  it('handles fetch errors gracefully', async () => {
    server.use(
      http.get('http://chh-err.local/llms.txt', () => HttpResponse.error()),
      http.get('http://chh-err.local/docs/page1', () => HttpResponse.error()),
    );

    const result = await check.run(makeCtx('chh-err.local', 'http://chh-err.local/docs/page1'));
    expect(result.details?.fetchErrors).toBeGreaterThanOrEqual(1);
  });

  it('passes with s-maxage taking precedence over max-age', async () => {
    const headers = {
      'Cache-Control': 'max-age=604800, s-maxage=300',
      'Content-Type': 'text/html',
    };
    server.use(
      http.get(
        'http://chh-smaxage.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers }),
      ),
      http.get(
        'http://chh-smaxage.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers }),
      ),
    );

    const result = await check.run(
      makeCtx('chh-smaxage.local', 'http://chh-smaxage.local/docs/page1'),
    );
    expect(result.status).toBe('pass');
    const endpoints = result.details?.endpointResults as Array<{
      sMaxAge: number;
      effectiveMaxAge: number;
    }>;
    expect(endpoints[0].sMaxAge).toBe(300);
    expect(endpoints[0].effectiveMaxAge).toBe(300);
  });

  it('passes with ETag/Last-Modified but no max-age', async () => {
    const headers = {
      ETag: '"abc"',
      'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT',
      'Content-Type': 'text/html',
    };
    server.use(
      http.get(
        'http://chh-etagonly.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers }),
      ),
      http.get(
        'http://chh-etagonly.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers }),
      ),
    );

    const result = await check.run(
      makeCtx('chh-etagonly.local', 'http://chh-etagonly.local/docs/page1'),
    );
    expect(result.status).toBe('pass');
  });

  it('uses Expires header as fallback when no max-age', async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toUTCString(); // 1 hour from now
    const headers = { Expires: futureDate, 'Content-Type': 'text/html' };
    server.use(
      http.get(
        'http://chh-expires.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers }),
      ),
      http.get(
        'http://chh-expires.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers }),
      ),
    );

    const result = await check.run(
      makeCtx('chh-expires.local', 'http://chh-expires.local/docs/page1'),
    );
    expect(result.status).toBe('pass');
    const endpoints = result.details?.endpointResults as Array<{ effectiveMaxAge: number }>;
    // Should be approximately 3600 seconds
    expect(endpoints[0].effectiveMaxAge).toBeGreaterThan(3000);
    expect(endpoints[0].effectiveMaxAge).toBeLessThanOrEqual(3600);
  });

  it('fails when all fetches error out', async () => {
    server.use(
      http.get('http://chh-allfail.local/llms.txt', () => HttpResponse.error()),
      http.get('http://chh-allfail.local/docs/page1', () => HttpResponse.error()),
    );

    const result = await check.run(
      makeCtx('chh-allfail.local', 'http://chh-allfail.local/docs/page1'),
    );
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Could not fetch any endpoints');
  });

  it('fails with Cache-Control present but no useful directives', async () => {
    const headers = { 'Cache-Control': 'public', 'Content-Type': 'text/html' };
    server.use(
      http.get(
        'http://chh-public.local/llms.txt',
        () => new HttpResponse('# Docs', { status: 200, headers }),
      ),
      http.get(
        'http://chh-public.local/docs/page1',
        () => new HttpResponse('OK', { status: 200, headers }),
      ),
    );

    const result = await check.run(
      makeCtx('chh-public.local', 'http://chh-public.local/docs/page1'),
    );
    expect(result.status).toBe('fail');
  });

  it('also checks llms.txt endpoints', async () => {
    server.use(
      http.get(
        'http://chh-llms.local/llms.txt',
        () =>
          new HttpResponse(
            '# Docs\n## Links\n- [Page 1](http://chh-llms.local/docs/page1): First\n',
            {
              status: 200,
              headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' },
            },
          ),
      ),
      http.get(
        'http://chh-llms.local/docs/page1',
        () =>
          new HttpResponse('OK', {
            status: 200,
            headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = createContext('http://chh-llms.local', { requestDelay: 0 });
    const discovered: DiscoveredFile[] = [
      {
        url: 'http://chh-llms.local/llms.txt',
        content: '# Docs\n## Links\n- [Page 1](http://chh-llms.local/docs/page1): First\n',
        status: 200,
        redirected: false,
      },
    ];
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'llms-txt',
      status: 'pass',
      message: 'Found',
      details: { discoveredFiles: discovered },
    });

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.testedEndpoints).toBeGreaterThanOrEqual(2);
  });
});
