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

  const llms = (host: string, ...pages: string[]) =>
    `# Docs\n## Links\n${pages.map((p, i) => `- [Page ${i + 1}](http://${host}${p}): Page\n`).join('')}`;

  it('passes when pages return 200 with no redirects', async () => {
    server.use(
      http.get('http://rb-pass.local/docs/page1', () => new HttpResponse('OK', { status: 200 })),
    );

    const result = await check.run(makeCtx(llms('rb-pass.local', '/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.noRedirectCount).toBe(1);
  });

  it('passes when redirects are same-host', async () => {
    server.use(
      http.get(
        'http://rb-same.local/old-page',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: 'http://rb-same.local/new-page' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-same.local', '/old-page')));
    expect(result.status).toBe('pass');
    expect(result.details?.sameHostCount).toBe(1);
    expect(result.message).toContain('same-host');
  });

  it('warns on cross-host redirects', async () => {
    server.use(
      http.get(
        'http://rb-cross.local/docs/page1',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: 'http://other-host.local/docs/page1' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-cross.local', '/docs/page1')));
    expect(result.status).toBe('warn');
    expect(result.details?.crossHostCount).toBe(1);
    expect(result.message).toContain('cross-host');
  });

  it('fails on JavaScript redirects', async () => {
    server.use(
      http.get(
        'http://rb-js.local/docs/page1',
        () =>
          new HttpResponse('<html><script>window.location = "/new-page";</script></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-js.local', '/docs/page1')));
    expect(result.status).toBe('fail');
    expect(result.details?.jsRedirectCount).toBe(1);
    expect(result.message).toContain('JavaScript');
  });

  it('detects meta refresh redirects', async () => {
    server.use(
      http.get(
        'http://rb-meta.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><head><meta http-equiv="refresh" content="0;url=/new-page"></head></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-meta.local', '/docs/page1')));
    expect(result.status).toBe('fail');
    expect(result.details?.jsRedirectCount).toBe(1);
  });

  it('handles mixed results: js redirect takes precedence over cross-host', async () => {
    server.use(
      http.get(
        'http://rb-mix.local/docs/page1',
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: 'http://other.local/page1' },
          }),
      ),
      http.get(
        'http://rb-mix.local/docs/page2',
        () =>
          new HttpResponse('<html><script>document.location.href="/new"</script></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-mix.local', '/docs/page1', '/docs/page2')));
    expect(result.status).toBe('fail');
    expect(result.details?.crossHostCount).toBe(1);
    expect(result.details?.jsRedirectCount).toBe(1);
    expect(result.message).toContain('JavaScript');
    expect(result.message).toContain('cross-host');
  });

  it('handles fetch errors gracefully', async () => {
    server.use(http.get('http://rb-err.local/docs/page1', () => HttpResponse.error()));

    const result = await check.run(makeCtx(llms('rb-err.local', '/docs/page1')));
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('fails when all fetches error out', async () => {
    server.use(http.get('http://rb-allfail.local/docs/page1', () => HttpResponse.error()));

    const result = await check.run(makeCtx(llms('rb-allfail.local', '/docs/page1')));
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Could not test any URLs');
  });

  it('handles relative Location headers', async () => {
    server.use(
      http.get(
        'http://rb-rel.local/docs/old',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: '/docs/new' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-rel.local', '/docs/old')));
    expect(result.status).toBe('pass');
    expect(result.details?.sameHostCount).toBe(1);
  });

  it('ignores window.location inside <code> blocks', async () => {
    server.use(
      http.get(
        'http://rb-code.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><p>Use <code>window.location = "/page"</code> to navigate.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-code.local', '/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('ignores window.location inside <pre> blocks', async () => {
    server.use(
      http.get(
        'http://rb-pre.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><pre class="highlight"><code>window.location.href = "/new";</code></pre></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-pre.local', '/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('ignores meta refresh inside <pre> blocks', async () => {
    server.use(
      http.get(
        'http://rb-premeta.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><pre>&lt;meta http-equiv="refresh" content="0;url=/new"&gt;</pre></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-premeta.local', '/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('ignores window.location property reads in <script> tags', async () => {
    server.use(
      http.get(
        'http://rb-read.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><script>window._uxa.push(["setPath", window.location.pathname+window.location.hash]);</script></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-read.local', '/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.jsRedirectCount).toBe(0);
  });

  it('still detects real JS redirects in <script> tags', async () => {
    server.use(
      http.get(
        'http://rb-script.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><pre>example code</pre><script>window.location = "/new";</script></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-script.local', '/docs/page1')));
    expect(result.status).toBe('fail');
    expect(result.details?.jsRedirectCount).toBe(1);
  });

  it('classifies 302 redirects the same as 301', async () => {
    server.use(
      http.get(
        'http://rb-302.local/docs/page1',
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: 'http://external.local/docs/page1' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('rb-302.local', '/docs/page1')));
    expect(result.status).toBe('warn');
    expect(result.details?.crossHostCount).toBe(1);
  });
});
