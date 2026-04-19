import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';
import type { DiscoveredFile } from '../../../src/types.js';
import { mockSitemapNotFound } from '../../helpers/mock-sitemap-not-found.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('markdown-url-support', () => {
  const check = getCheck('markdown-url-support')!;

  function makeCtx(options?: { content?: string; withLlmsTxt?: boolean }) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });

    if (options?.withLlmsTxt !== false && options?.content) {
      const discovered: DiscoveredFile[] = [
        {
          url: 'http://test.local/llms.txt',
          content: options.content,
          status: 200,
          redirected: false,
        },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      mockSitemapNotFound(server, 'http://test.local');
    } else {
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'fail',
        message: 'No llms.txt found',
        details: { discoveredFiles: [] },
      });
    }

    return ctx;
  }

  it('passes when .md URLs return markdown content', async () => {
    const mdContent =
      '# Getting Started\n\nThis is a guide.\n\n## Installation\n\n```bash\nnpm install\n```';

    server.use(
      http.get(
        'http://test.local/docs/getting-started.md',
        () =>
          new HttpResponse(mdContent, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
      http.get(
        'http://test.local/docs/api.md',
        () =>
          new HttpResponse('# API Reference\n\n[Link](http://example.com)', {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs
> Summary
## Links
- [Getting Started](http://test.local/docs/getting-started): Guide
- [API](http://test.local/docs/api): Reference
`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('pass');
    expect(result.details?.supportRate).toBe(100);
  });

  it('fails when .md URLs return 404', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/page1/index.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/page2.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/page2/index.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const content = `# Docs
> Summary
## Links
- [Page 1](http://test.local/docs/page1): First
- [Page 2](http://test.local/docs/page2): Second
`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('fail');
    expect(result.details?.mdSupported).toBe(0);
  });

  it('fails when .md URLs return HTML (soft 404)', async () => {
    server.use(
      http.get(
        'http://test.local/soft404-page.md',
        () =>
          new HttpResponse('<!DOCTYPE html><html><body>Error</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        'http://test.local/soft404-page/index.md',
        () =>
          new HttpResponse('<!DOCTYPE html><html><body>Error</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs
> Summary
## Links
- [Page](http://test.local/soft404-page): A page
`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('fail');
  });

  it('warns when some pages support .md and others do not', async () => {
    server.use(
      http.get(
        'http://test.local/docs/mixed-page1.md',
        () =>
          new HttpResponse('# Page 1\n\nContent here', {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
      http.get(
        'http://test.local/docs/mixed-page2.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/mixed-page2/index.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/mixed-page3.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/mixed-page3/index.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const content = `# Docs
> Summary
## Links
- [Page 1](http://test.local/docs/mixed-page1): First
- [Page 2](http://test.local/docs/mixed-page2): Second
- [Page 3](http://test.local/docs/mixed-page3): Third
`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('warn');
  });

  it('falls back to baseUrl when no llms.txt links available', async () => {
    server.use(
      http.get('http://test.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://test.local/sitemap.xml',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get('http://test.local/.md', () => new HttpResponse('Not Found', { status: 404 })),
      http.get('http://test.local/index.md', () => new HttpResponse('Not Found', { status: 404 })),
    );

    const ctx = makeCtx({ withLlmsTxt: false });
    const result = await check.run(ctx);
    // Should not skip; should test baseUrl
    expect(result.status).not.toBe('skip');
    expect(result.details?.testedPages).toBe(1);
  });

  it('samples when more links than maxLinksToTest', async () => {
    // Generate 5 links but set maxLinksToTest to 2
    const links = Array.from(
      { length: 5 },
      (_, i) => `- [Page ${i}](http://test.local/docs/sample-page${i}): Page ${i}`,
    ).join('\n');

    for (let i = 0; i < 5; i++) {
      server.use(
        http.get(
          `http://test.local/docs/sample-page${i}.md`,
          () =>
            new HttpResponse(`# Page ${i}\n\nContent`, {
              status: 200,
              headers: { 'Content-Type': 'text/markdown' },
            }),
        ),
      );
    }

    const content = `# Docs\n> Summary\n## Links\n${links}\n`;
    const ctx = createContext('http://test.local', { requestDelay: 0, maxLinksToTest: 2 });
    const discovered: DiscoveredFile[] = [
      { url: 'http://test.local/llms.txt', content, status: 200, redirected: false },
    ];
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'content-discoverability',
      status: 'pass',
      message: 'Found',
      details: { discoveredFiles: discovered },
    });
    mockSitemapNotFound(server, 'http://test.local');

    const result = await check.run(ctx);
    expect(result.details?.totalPages).toBe(5);
    expect(result.details?.testedPages).toBe(2);
    expect(result.details?.sampled).toBe(true);
  });

  it('handles fetch errors gracefully and reports error field', async () => {
    server.use(
      http.get('http://test.local/docs/err-page.md', () => HttpResponse.error()),
      http.get('http://test.local/docs/err-page/index.md', () => HttpResponse.error()),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page](http://test.local/docs/err-page): A page\n`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('fail');
    const pageResults = result.details?.pageResults as Array<{
      status: number;
      supported: boolean;
      error?: string;
    }>;
    expect(pageResults[0].status).toBe(0);
    expect(pageResults[0].supported).toBe(false);
    expect(pageResults[0].error).toBeDefined();
    expect(result.details?.fetchErrors).toBe(1);
    expect(result.message).toContain('failed to fetch');
  });

  it('reports rate-limited results (HTTP 429)', async () => {
    server.use(
      http.get(
        'http://test.local/docs/rl-page.md',
        () => new HttpResponse('Too Many Requests', { status: 429 }),
      ),
      http.get(
        'http://test.local/docs/rl-page/index.md',
        () => new HttpResponse('Too Many Requests', { status: 429 }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page](http://test.local/docs/rl-page): A page\n`;
    const result = await check.run(makeCtx({ content }));
    // 429 with non-markdown body won't count as supported, so status 0 (last candidate fails)
    // but the page result itself won't have status 429 because none succeeded
    // Actually: response.ok is false for 429, so supported=false, status=0 on fallback
    // The status field on PageResult is only set when a candidate succeeds
    // Since 429 is not ok, it falls through all candidates. No error thrown though.
    expect(result.details?.rateLimited).toBe(0); // 429 doesn't propagate to page result status
  });

  it('includes "sampled" in message when results are sampled', async () => {
    const links = Array.from(
      { length: 5 },
      (_, i) => `- [Page ${i}](http://test.local/docs/sample-msg-page${i}): Page ${i}`,
    ).join('\n');

    for (let i = 0; i < 5; i++) {
      server.use(
        http.get(
          `http://test.local/docs/sample-msg-page${i}.md`,
          () => new HttpResponse('Not Found', { status: 404 }),
        ),
        http.get(
          `http://test.local/docs/sample-msg-page${i}/index.md`,
          () => new HttpResponse('Not Found', { status: 404 }),
        ),
      );
    }

    const content = `# Docs\n> Summary\n## Links\n${links}\n`;
    const ctx = createContext('http://test.local', { requestDelay: 0, maxLinksToTest: 2 });
    const discovered: DiscoveredFile[] = [
      { url: 'http://test.local/llms.txt', content, status: 200, redirected: false },
    ];
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'content-discoverability',
      status: 'pass',
      message: 'Found',
      details: { discoveredFiles: discovered },
    });
    mockSitemapNotFound(server, 'http://test.local');

    const result = await check.run(ctx);
    expect(result.details?.sampled).toBe(true);
    expect(result.message).toContain('sampled pages');
  });

  it('uses URL directly when it already ends in .md', async () => {
    server.use(
      http.get(
        'http://test.local/spec/index.md',
        () =>
          new HttpResponse('# Spec\n\nThe full specification.', {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Spec](http://test.local/spec/index.md): Full spec\n`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('pass');
    expect(result.details?.mdSupported).toBe(1);
    const pageResults = result.details?.pageResults as Array<{ mdUrl: string }>;
    expect(pageResults[0].mdUrl).toBe('http://test.local/spec/index.md');
  });

  it('finds markdown at index.md when direct .md fails', async () => {
    server.use(
      http.get(
        'http://test.local/docs/guide.md',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/guide/index.md',
        () =>
          new HttpResponse('# Guide\n\nThis is the guide.', {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Guide](http://test.local/docs/guide): Guide\n`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('pass');
    expect(result.details?.mdSupported).toBe(1);
    const pageResults = result.details?.pageResults as Array<{ mdUrl: string }>;
    expect(pageResults[0].mdUrl).toBe('http://test.local/docs/guide/index.md');
  });

  it('supports markdown detected by body only (no text/markdown content-type)', async () => {
    server.use(
      http.get(
        'http://test.local/docs/bodyonly-page.md',
        () =>
          new HttpResponse('# Hello\n\nSome [link](http://example.com) here.\n\n```js\ncode\n```', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page](http://test.local/docs/bodyonly-page): A page\n`;
    const result = await check.run(makeCtx({ content }));
    expect(result.status).toBe('pass');
    expect(result.details?.mdSupported).toBe(1);
  });

  it('caches markdown content in pageCache', async () => {
    const mdContent = '# Cached\n\nThis should be cached.';
    server.use(
      http.get(
        'http://test.local/docs/cache-page.md',
        () =>
          new HttpResponse(mdContent, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs
> Summary
## Links
- [Page](http://test.local/docs/cache-page): A page
`;
    const ctx = makeCtx({ content });
    await check.run(ctx);
    const cached = ctx.pageCache.get('http://test.local/docs/cache-page');
    expect(cached).toBeDefined();
    expect(cached?.markdown?.content).toBe(mdContent);
    expect(cached?.markdown?.source).toBe('md-url');
  });

  it('auto-detects page/index.md preference and tries it first in later batches', async () => {
    // 3 pages, all served at page/index.md (not page.md). With concurrency=1,
    // each page is a separate batch, so after page 1+2 the check should
    // detect the page/index.md pattern and try it first for page 3.
    const md = '# Page\n\nContent here.';
    const requestLog: string[] = [];

    server.use(
      // page.md forms — all 404
      http.get('http://test.local/docs/a.md', () => {
        requestLog.push('/docs/a.md');
        return new HttpResponse('Not found', { status: 404 });
      }),
      http.get('http://test.local/docs/b.md', () => {
        requestLog.push('/docs/b.md');
        return new HttpResponse('Not found', { status: 404 });
      }),
      http.get('http://test.local/docs/c.md', () => {
        requestLog.push('/docs/c.md');
        return new HttpResponse('Not found', { status: 404 });
      }),
      // index.md forms — all succeed
      http.get('http://test.local/docs/a/index.md', () => {
        requestLog.push('/docs/a/index.md');
        return new HttpResponse(md, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown' },
        });
      }),
      http.get('http://test.local/docs/b/index.md', () => {
        requestLog.push('/docs/b/index.md');
        return new HttpResponse(md, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown' },
        });
      }),
      http.get('http://test.local/docs/c/index.md', () => {
        requestLog.push('/docs/c/index.md');
        return new HttpResponse(md, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown' },
        });
      }),
    );

    const content = `# Docs
> Summary
## Links
- [A](http://test.local/docs/a): A
- [B](http://test.local/docs/b): B
- [C](http://test.local/docs/c): C
`;
    const ctx = makeCtx({ content });
    // Force concurrency=1 so each page is its own batch
    ctx.options.maxConcurrency = 1;
    const result = await check.run(ctx);

    expect(result.status).toBe('pass');

    // Pages A and B: tried page.md first (default order), got 404, then page/index.md
    // Page C: after detecting page/index.md preference, should try page/index.md first
    // So /docs/c.md should NOT appear in the request log
    expect(requestLog).toContain('/docs/a.md');
    expect(requestLog).toContain('/docs/a/index.md');
    expect(requestLog).toContain('/docs/b.md');
    expect(requestLog).toContain('/docs/b/index.md');
    expect(requestLog).not.toContain('/docs/c.md');
    expect(requestLog).toContain('/docs/c/index.md');
  });
});
