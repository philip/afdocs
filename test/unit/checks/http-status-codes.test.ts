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

describe('http-status-codes', () => {
  const check = getCheck('http-status-codes')!;

  function makeCtx(llmsTxtContent?: string) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });

    if (llmsTxtContent) {
      const discovered: DiscoveredFile[] = [
        {
          url: 'http://test.local/llms.txt',
          content: llmsTxtContent,
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
    } else {
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'llms-txt',
        status: 'fail',
        message: 'No llms.txt found',
        details: { discoveredFiles: [] },
      });
    }

    return ctx;
  }

  it('passes when bad URLs return 404', async () => {
    server.use(
      http.get(
        'http://hsc-pass.local/docs/page1-afdocs-nonexistent-8f3a',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-pass.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.details?.soft404Count).toBe(0);
    expect(result.details?.correctErrorCount).toBe(1);
  });

  it('fails when bad URL returns 200 (soft 404)', async () => {
    server.use(
      http.get(
        'http://hsc-soft.local/docs/page1-afdocs-nonexistent-8f3a',
        () =>
          new HttpResponse('<html><body><h1>Welcome!</h1></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-soft.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.soft404Count).toBe(1);
  });

  it('detects body hints in soft 404 responses', async () => {
    server.use(
      http.get(
        'http://hsc-hint.local/docs/page1-afdocs-nonexistent-8f3a',
        () =>
          new HttpResponse('<html><body><h1>Page Not Found</h1></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-hint.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    const pageResults = result.details?.pageResults as Array<{ bodyHint?: string }>;
    expect(pageResults[0].bodyHint).toContain('not found');
  });

  it('handles mixed results (some 404, some soft 404)', async () => {
    server.use(
      http.get(
        'http://hsc-mix.local/docs/page1-afdocs-nonexistent-8f3a',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://hsc-mix.local/docs/page2-afdocs-nonexistent-8f3a',
        () => new HttpResponse('<html><body>OK</body></html>', { status: 200 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-mix.local/docs/page1): First\n- [Page 2](http://hsc-mix.local/docs/page2): Second\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.soft404Count).toBe(1);
    expect(result.details?.correctErrorCount).toBe(1);
  });

  it('handles fetch errors gracefully', async () => {
    server.use(
      http.get('http://hsc-err.local/docs/page1-afdocs-nonexistent-8f3a', () =>
        HttpResponse.error(),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-err.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('passes when redirect leads to 404', async () => {
    server.use(
      http.get(
        'http://hsc-r404.local/docs/page1-afdocs-nonexistent-8f3a',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: 'http://hsc-r404.local/not-found' },
          }),
      ),
      http.get(
        'http://hsc-r404.local/not-found',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-r404.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.details?.correctErrorCount).toBe(1);
  });

  it('fails when redirect leads to 200 (soft 404)', async () => {
    server.use(
      http.get(
        'http://hsc-r200.local/docs/page1-afdocs-nonexistent-8f3a',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: 'http://hsc-r200.local/' },
          }),
      ),
      http.get(
        'http://hsc-r200.local/',
        () =>
          new HttpResponse('<html><body><h1>Home</h1></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-r200.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.soft404Count).toBe(1);
  });

  it('fails when all fetches error out', async () => {
    server.use(
      http.get('http://hsc-allfail.local/docs/page1-afdocs-nonexistent-8f3a', () =>
        HttpResponse.error(),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-allfail.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    // The one result is a fetch-error, so tested.length === 0
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Could not test any URLs');
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('includes fetch error count in pass message suffix', async () => {
    server.use(
      http.get(
        'http://hsc-partial.local/docs/page1-afdocs-nonexistent-8f3a',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get('http://hsc-partial.local/docs/page2-afdocs-nonexistent-8f3a', () =>
        HttpResponse.error(),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-partial.local/docs/page1): First\n- [Page 2](http://hsc-partial.local/docs/page2): Second\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.message).toContain('1 failed to fetch');
  });

  it('strips fragments from test URLs', async () => {
    server.use(
      http.get(
        'http://hsc-frag.local/docs/page1-afdocs-nonexistent-8f3a',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://hsc-frag.local/docs/page1#section): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    const pageResults = result.details?.pageResults as Array<{ testUrl: string }>;
    expect(pageResults[0].testUrl).not.toContain('#');
  });
});
