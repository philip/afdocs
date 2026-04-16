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

describe('llms-txt-directive', () => {
  const check = getCheck('llms-txt-directive')!;

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

  const llms = (...pages: string[]) =>
    `# Docs\n## Links\n${pages.map((p, i) => `- [Page ${i + 1}](http://test.local${p}): Page\n`).join('')}`;

  it('passes when directive link is near the top of page', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><a href="/llms.txt">Documentation index for AI agents</a><h1>Welcome</h1><p>Content here...</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
    expect(result.details?.nearTopCount).toBe(1);
    expect(result.message).toContain('near the top');
  });

  it('passes when llms.txt is mentioned as text near the top', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><p>See our llms.txt for a full documentation index.</p><h1>Docs</h1><p>Content...</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
  });

  it('passes with visually hidden directive using sr-only', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><span class="sr-only"><a href="/llms.txt">Full documentation index</a></span><h1>Docs</h1><p>Content...</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
  });

  it('warns when directive is buried deep in the page', async () => {
    const padding = '<p>Lorem ipsum dolor sit amet.</p>'.repeat(200);
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(`<html><body>${padding}<a href="/llms.txt">Index</a></body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('warn');
    expect(result.details?.buriedCount).toBe(1);
    expect(result.message).toContain('buried deep');
  });

  it('warns when some pages have directive and some do not', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><a href="/llms.txt">Index</a><p>Content</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
      http.get(
        'http://test.local/docs/page2',
        () =>
          new HttpResponse('<html><body><h1>No directive here</h1><p>Content</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1', '/docs/page2')));
    expect(result.status).toBe('warn');
    expect(result.details?.foundCount).toBe(1);
    expect(result.details?.notFoundCount).toBe(1);
    expect(result.message).toContain('missing');
  });

  it('fails when no directive found in any page', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><h1>Welcome</h1><p>No agent directive here.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('fail');
    expect(result.details?.foundCount).toBe(0);
  });

  it('fails when all pages fail to fetch', async () => {
    server.use(http.get('http://test.local/docs/page1', () => HttpResponse.error()));

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Could not test');
  });

  it('handles non-200 responses gracefully', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('fail');
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('detects full URL links to llms.txt', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><a href="https://example.com/llms.txt">Documentation Index</a><p>Content</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
  });

  it('ignores pages without body tags', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse('<a href="/llms.txt">Index</a><p>No body tags in this response</p>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    // Should still work by falling back to full HTML
    const result = await check.run(makeCtx(llms('/docs/page1')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
  });

  it('strips .md from URLs and fetches HTML version', async () => {
    // llms.txt links to .md URLs, but directive is in the HTML version
    const content = '<p>Documentation content.</p>'.repeat(10);
    server.use(
      http.get(
        'http://test.local/docs/page1/',
        () =>
          new HttpResponse(
            `<html><body><a href="/llms.txt">Documentation index</a><h1>Docs</h1>${content}</body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1/index.md')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
  });

  it('finds directive in markdown content when HTML is not available', async () => {
    // HTML URL returns the markdown directly (some sites do this)
    server.use(
      http.get(
        'http://test.local/docs/page1/',
        () =>
          new HttpResponse(
            'For AI agents: see [documentation index](/llms.txt) for navigation.\n\n# Welcome\n\nContent here.',
            { status: 200, headers: { 'Content-Type': 'text/markdown' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1/index.md')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
    const pages = result.details?.pageResults as Array<{ source?: string }>;
    expect(pages[0].source).toBe('markdown');
  });

  it('falls back to .md URL when HTML version has no directive', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1/',
        () =>
          new HttpResponse('<html><body><h1>Docs</h1><p>No directive here</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        'http://test.local/docs/page1/index.md',
        () =>
          new HttpResponse(
            'For AI agents: see /llms.txt for a documentation index.\n\n# Docs\n\nContent.',
            { status: 200, headers: { 'Content-Type': 'text/markdown' } },
          ),
      ),
    );

    const result = await check.run(makeCtx(llms('/docs/page1/index.md')));
    expect(result.status).toBe('pass');
    expect(result.details?.foundCount).toBe(1);
    const pages = result.details?.pageResults as Array<{ source?: string }>;
    expect(pages[0].source).toBe('markdown');
  });
});
