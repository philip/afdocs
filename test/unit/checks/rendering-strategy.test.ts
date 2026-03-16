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

describe('rendering-strategy', () => {
  const check = getCheck('rendering-strategy')!;

  function makeCtx(domain: string, content: string) {
    const ctx = createContext(`http://${domain}`, { requestDelay: 0 });
    const discovered: DiscoveredFile[] = [
      { url: `http://${domain}/llms.txt`, content, status: 200, redirected: false },
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

  function llmsTxt(domain: string, paths: string[]): string {
    const links = paths.map((p, i) => `- [Page ${i}](http://${domain}${p}): Page ${i}`).join('\n');
    return `# Docs\n> Summary\n## Links\n${links}\n`;
  }

  it('passes for markdown (non-HTML) responses', async () => {
    const domain = 'rs-md-pass.local';
    const md = '# Guide\n\nThis is markdown content about the API.\n';
    server.use(
      http.get(
        `http://${domain}/docs/page1`,
        () =>
          new HttpResponse(md, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
          }),
      ),
    );

    const result = await check.run(makeCtx(domain, llmsTxt(domain, ['/docs/page1'])));
    expect(result.status).toBe('pass');
    const pageResults = result.details?.pageResults as Array<{
      analysis: {
        hasContent: boolean;
        hasSpaMarkers: boolean;
        spaMarker: string | null;
        visibleTextLength: number;
        htmlLength: number;
      };
    }>;
    const a = pageResults[0].analysis;
    expect(a.hasContent).toBe(true);
    expect(a.hasSpaMarkers).toBe(false);
    expect(a.spaMarker).toBeNull();
    expect(a.visibleTextLength).toBe(md.length);
    expect(a.htmlLength).toBe(0);
  });

  it('passes for all pages server-rendered', async () => {
    const domain = 'rs-all-pass.local';
    const htmlPage = (title: string) =>
      `<html><body><h1>${title}</h1><p>Some real content here for the page.</p></body></html>`;

    server.use(
      http.get(
        `http://${domain}/docs/page1`,
        () =>
          new HttpResponse(htmlPage('Page One'), {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        `http://${domain}/docs/page2`,
        () =>
          new HttpResponse(htmlPage('Page Two'), {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(
      makeCtx(domain, llmsTxt(domain, ['/docs/page1', '/docs/page2'])),
    );
    expect(result.status).toBe('pass');
    expect(result.message).toContain('All 2 pages contain server-rendered content');
  });

  it('fails for SPA shell with framework hint', async () => {
    const domain = 'rs-spa-fail.local';
    // Gatsby SPA shell: has the marker, no real content
    const spaHtml =
      '<html><body><div id="___gatsby"><div id="gatsby-focus-wrapper"></div></div>' +
      '<script src="/app.js"></script></body></html>';

    server.use(
      http.get(
        `http://${domain}/docs/page1`,
        () =>
          new HttpResponse(spaHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(domain, llmsTxt(domain, ['/docs/page1'])));
    expect(result.status).toBe('fail');
    expect(result.message).toContain('client-side rendered SPA shells');
    expect(result.message).toContain('___gatsby');
  });

  it('warns for sparse content', async () => {
    const domain = 'rs-sparse-warn.local';
    // Has SPA marker + one heading (triggers warn path in pageStatus):
    // hasSpaMarkers=true, hasContent=false (only 1 heading, not >=3),
    // but contentHeadings >= 1 => warn
    const sparseHtml =
      '<html><body><div id="__next">' + '<h1>Getting Started Guide</h1>' + '</div></body></html>';

    server.use(
      http.get(
        `http://${domain}/docs/page1`,
        () =>
          new HttpResponse(sparseHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(domain, llmsTxt(domain, ['/docs/page1'])));
    expect(result.status).toBe('warn');
    expect(result.message).toContain('little substantive content');
    expect(result.message).toContain('headings');
  });

  it('reports mixed SPA shells and sparse content', async () => {
    const domain = 'rs-mixed.local';
    // Page 1: full SPA shell (fail) with Gatsby marker
    const spaHtml =
      '<html><body><div id="___gatsby"></div>' + '<script src="/app.js"></script></body></html>';
    // Page 2: sparse content (warn) with __next marker + one heading
    const sparseHtml =
      '<html><body><div id="__next">' + '<h1>Installation Guide</h1>' + '</div></body></html>';

    server.use(
      http.get(
        `http://${domain}/docs/page1`,
        () =>
          new HttpResponse(spaHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        `http://${domain}/docs/page2`,
        () =>
          new HttpResponse(sparseHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(
      makeCtx(domain, llmsTxt(domain, ['/docs/page1', '/docs/page2'])),
    );
    expect(result.status).toBe('fail');
    expect(result.message).toContain('1 of 2 pages appear to be client-side rendered SPA shells');
    expect(result.message).toContain('1 more have page structure but little substantive content');
  });

  it('appends fetch error count to message', async () => {
    const domain = 'rs-fetch-err.local';
    const goodHtml =
      '<html><body><h1>Working Page</h1><p>Content is here and accessible.</p></body></html>';

    server.use(
      http.get(
        `http://${domain}/docs/good`,
        () =>
          new HttpResponse(goodHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(`http://${domain}/docs/broken`, () => HttpResponse.error()),
    );

    const result = await check.run(
      makeCtx(domain, llmsTxt(domain, ['/docs/good', '/docs/broken'])),
    );
    expect(result.message).toContain('; 1 failed to fetch');
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('fails when all pages fail to fetch', async () => {
    const domain = 'rs-all-err.local';

    server.use(
      http.get(`http://${domain}/docs/page1`, () => HttpResponse.error()),
      http.get(`http://${domain}/docs/page2`, () => HttpResponse.error()),
    );

    const result = await check.run(
      makeCtx(domain, llmsTxt(domain, ['/docs/page1', '/docs/page2'])),
    );
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Could not fetch any pages');
    expect(result.message).toContain('; 2 failed to fetch');
  });

  it('fails when SPA shell but no framework marker', async () => {
    const domain = 'rs-generic-root.local';
    // id="root" is a generic SPA marker with no content
    const spaHtml =
      '<html><body><div id="root"></div>' + '<script src="/bundle.js"></script></body></html>';

    server.use(
      http.get(
        `http://${domain}/docs/page1`,
        () =>
          new HttpResponse(spaHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const result = await check.run(makeCtx(domain, llmsTxt(domain, ['/docs/page1'])));
    expect(result.status).toBe('fail');
    expect(result.message).toContain('client-side rendered SPA shells');
    // "root" extracted from id="root" via the replace logic
    expect(result.message).toContain('root detected');
  });
});
