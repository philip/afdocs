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

describe('redirect-behavior', () => {
  const check = getCheck('redirect-behavior')!;

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

  const llms = (...pages: string[]) =>
    `# Docs\n## Links\n${pages.map((p, i) => `- [Page ${i + 1}](http://test.local${p}): Page\n`).join('')}`;

  it('passes when pages return 200 with no redirects', async () => {
    server.use(
      http.get('http://test.local/docs/rb-pass', () => new HttpResponse('OK', { status: 200 })),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-pass')));
    expect(result.status).toBe('pass');
    expect(result.details?.noRedirectCount).toBe(1);
  });

  it('passes when redirects are same-host', async () => {
    server.use(
      http.get(
        'http://test.local/rb-same/old-page',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: 'http://test.local/rb-same/new-page' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/rb-same/old-page')));
    expect(result.status).toBe('pass');
    expect(result.details?.sameHostCount).toBe(1);
    expect(result.message).toContain('same-host');
  });

  it('warns on cross-host redirects', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-cross',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: 'http://other-host.local/docs/page1' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-cross')));
    expect(result.status).toBe('warn');
    expect(result.details?.crossHostCount).toBe(1);
    expect(result.message).toContain('cross-host');
  });

  it('fails on JavaScript redirects', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-js',
        () =>
          new HttpResponse('<html><script>window.location = "/new-page";</script></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-js')));
    expect(result.status).toBe('fail');
    expect(result.details?.jsRedirectCount).toBe(1);
    expect(result.message).toContain('JavaScript');
  });

  it('detects meta refresh redirects', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-meta',
        () =>
          new HttpResponse(
            '<html><head><meta http-equiv="refresh" content="0;url=/new-page"></head></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-meta')));
    expect(result.status).toBe('fail');
    expect(result.details?.jsRedirectCount).toBe(1);
  });

  it('handles mixed results: js redirect takes precedence over cross-host', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-mix1',
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: 'http://other.local/page1' },
          }),
      ),
      http.get(
        'http://test.local/docs/rb-mix2',
        () =>
          new HttpResponse('<html><script>document.location.href="/new"</script></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-mix1', '/docs/rb-mix2')));
    expect(result.status).toBe('fail');
    expect(result.details?.crossHostCount).toBe(1);
    expect(result.details?.jsRedirectCount).toBe(1);
    expect(result.message).toContain('JavaScript');
    expect(result.message).toContain('cross-host');
  });

  it('handles fetch errors gracefully', async () => {
    server.use(http.get('http://test.local/docs/rb-err', () => HttpResponse.error()));

    const result = await check.run(makeCtx(llms('/docs/rb-err')));
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('fails when all fetches error out', async () => {
    server.use(http.get('http://test.local/docs/rb-allfail', () => HttpResponse.error()));

    const result = await check.run(makeCtx(llms('/docs/rb-allfail')));
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Could not test any URLs');
  });

  it('handles relative Location headers', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-rel-old',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: '/docs/rb-rel-new' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-rel-old')));
    expect(result.status).toBe('pass');
    expect(result.details?.sameHostCount).toBe(1);
  });

  it('ignores window.location inside <code> blocks', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-code',
        () =>
          new HttpResponse(
            '<html><body><p>Use <code>window.location = "/page"</code> to navigate.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-code')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('ignores window.location inside <pre> blocks', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-pre',
        () =>
          new HttpResponse(
            '<html><body><pre class="highlight"><code>window.location.href = "/new";</code></pre></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-pre')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('ignores meta refresh inside <pre> blocks', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-premeta',
        () =>
          new HttpResponse(
            '<html><body><pre>&lt;meta http-equiv="refresh" content="0;url=/new"&gt;</pre></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-premeta')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('ignores window.location property reads in <script> tags', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-read',
        () =>
          new HttpResponse(
            '<html><script>window._uxa.push(["setPath", window.location.pathname+window.location.hash]);</script></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-read')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('still detects real JS redirects in <script> tags', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-script',
        () =>
          new HttpResponse(
            '<html><body><pre>example code</pre><script>window.location = "/new";</script></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-script')));
    expect(result.status).toBe('fail');
    expect(result.details?.jsRedirectCount).toBe(1);
  });

  it('classifies 302 redirects the same as 301', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rb-302',
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: 'http://external.local/docs/page1' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/rb-302')));
    expect(result.status).toBe('warn');
    expect(result.details?.crossHostCount).toBe(1);
  });
});
