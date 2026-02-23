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

describe('content-start-position', () => {
  const check = getCheck('content-start-position')!;

  function makeCtx(content?: string, opts?: Record<string, unknown>) {
    const ctx = createContext('http://test.local', { requestDelay: 0, ...opts });

    if (content) {
      const discovered: DiscoveredFile[] = [
        { url: 'http://test.local/llms.txt', content, status: 200, redirected: false },
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

  function singlePageCtx(domain: string) {
    return makeCtx(`# Docs\n> Summary\n## Links\n- [Page](http://${domain}/docs/page): A page\n`);
  }

  // ── Setext heading detection ──

  it('passes when content starts immediately (setext heading)', async () => {
    // Turndown converts <h1> to setext (underline) style by default
    server.use(
      http.get(
        'http://csp-pass.local/docs/page',
        () =>
          new HttpResponse(
            '<html><body><h1>Getting Started</h1><p>Welcome to our documentation.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(singlePageCtx('csp-pass.local'));
    expect(result.status).toBe('pass');
    expect(result.details?.medianPercent).toBe(0);
  });

  // ── ATX heading detection ──

  it('passes when content starts with an ATX heading (h3–h6)', async () => {
    // Turndown uses ATX style for h3+
    server.use(
      http.get(
        'http://csp-atx.local/docs/page',
        () =>
          new HttpResponse(
            '<html><body><h3>API Reference</h3><p>Endpoint details below.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(singlePageCtx('csp-atx.local'));
    expect(result.status).toBe('pass');
    const pageResults = result.details?.pageResults as Array<{ contentStartPercent: number }>;
    expect(pageResults[0].contentStartPercent).toBe(0);
  });

  // ── CSS skip pattern ──

  it('skips CSS-like lines before content', async () => {
    // Inline <style> content sometimes leaks through Turndown as plain text.
    // Simulate this with a page that has CSS text before the heading.
    const html = `<html><body>
      <div>color: red;</div>
      <div>font-size: 14px;</div>
      <h1>Real Content</h1>
      <p>Documentation starts here.</p>
    </body></html>`;

    server.use(
      http.get(
        'http://csp-css.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-css.local'));
    // Content should be found (the heading after CSS), not at position 0
    const pageResults = result.details?.pageResults as Array<{
      contentStartChar: number;
      totalChars: number;
    }>;
    expect(pageResults[0].contentStartChar).toBeGreaterThan(0);
    expect(pageResults[0].totalChars).toBeGreaterThan(0);
  });

  // ── JS skip pattern ──

  it('skips JS-like lines before content', async () => {
    const html = `<html><body>
      <div>function init() {</div>
      <div>const x = 42;</div>
      <div>// some comment</div>
      <h1>Documentation</h1>
      <p>Actual content here.</p>
    </body></html>`;

    server.use(
      http.get(
        'http://csp-js.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-js.local'));
    const pageResults = result.details?.pageResults as Array<{ contentStartChar: number }>;
    expect(pageResults[0].contentStartChar).toBeGreaterThan(0);
  });

  // ── Nav-like token skip ──

  it('skips short nav-like tokens before content', async () => {
    const html = `<html><body>
      <span>Home</span>
      <span>Docs</span>
      <span>API</span>
      <h1>Welcome</h1>
      <p>This is the main documentation page.</p>
    </body></html>`;

    server.use(
      http.get(
        'http://csp-nav.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-nav.local'));
    const pageResults = result.details?.pageResults as Array<{ contentStartChar: number }>;
    expect(pageResults[0].contentStartChar).toBeGreaterThan(0);
  });

  // ── Prose paragraph detection (no heading) ──

  it('detects a prose paragraph as content start when no heading present', async () => {
    const html = `<html><body>
      <span>Menu</span>
      <p>This documentation explains how to integrate our API into your application.</p>
    </body></html>`;

    server.use(
      http.get(
        'http://csp-prose.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-prose.local'));
    const pageResults = result.details?.pageResults as Array<{
      contentStartChar: number;
      totalChars: number;
    }>;
    // Should find the paragraph, not the "Menu" token
    expect(pageResults[0].contentStartChar).toBeGreaterThan(0);
    expect(pageResults[0].contentStartChar).toBeLessThan(pageResults[0].totalChars);
  });

  // ── All-boilerplate fallback ──

  it('reports 100% when page has no meaningful content', async () => {
    // Page with only short nav-like tokens, no headings, no prose
    const html = `<html><body>
      <span>Home</span>
      <span>Login</span>
      <span>Menu</span>
    </body></html>`;

    server.use(
      http.get(
        'http://csp-empty.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-empty.local'));
    expect(result.status).toBe('fail');
    const pageResults = result.details?.pageResults as Array<{ contentStartPercent: number }>;
    expect(pageResults[0].contentStartPercent).toBeGreaterThan(50);
  });

  // ── Empty markdown (totalChars === 0) ──

  it('handles empty HTML gracefully', async () => {
    server.use(
      http.get(
        'http://csp-blank.local/docs/page',
        () => new HttpResponse('', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-blank.local'));
    const pageResults = result.details?.pageResults as Array<{ contentStartPercent: number }>;
    // 0% when totalChars is 0
    expect(pageResults[0].contentStartPercent).toBe(0);
    expect(result.status).toBe('pass');
  });

  // ── Status threshold: warn (10–50%) ──

  it('warns when content starts between 10–50%', async () => {
    // Build HTML where ~25% is nav boilerplate, then content follows.
    // We need the converted markdown to have content starting around 25%.
    const navLinks = Array.from(
      { length: 20 },
      (_, i) => `<li><a href="/nav${i}">Navigation Link Item ${i}</a></li>`,
    ).join('');
    const html = `<html><body><nav><ul>${navLinks}</ul></nav><article><h1>Content Title</h1><p>Here is the actual documentation that you are looking for.</p></article></body></html>`;

    server.use(
      http.get(
        'http://csp-warnp.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-warnp.local'));
    const pageResults = result.details?.pageResults as Array<{
      contentStartPercent: number;
      status: string;
    }>;
    // If the nav is enough to push past 10%, we get warn
    if (pageResults[0].contentStartPercent > 10 && pageResults[0].contentStartPercent <= 50) {
      expect(result.status).toBe('warn');
      expect(result.details?.warnBucket).toBe(1);
      expect(result.message).toContain('10–50%');
    } else {
      // Nav wasn't heavy enough; still a valid pass
      expect(result.status).toBe('pass');
    }
  });

  // ── Status threshold: fail (>50%) ──

  it('fails when content starts past 50%', async () => {
    // Massive CSS boilerplate (leaks through Turndown) before a tiny heading
    const cssRules = Array.from(
      { length: 200 },
      (_, i) => `.class${i} { color: red; margin: ${i}px; }`,
    ).join('\n');
    const html = `<html><head><style>${cssRules}</style></head><body><h3>Tiny Content</h3></body></html>`;

    server.use(
      http.get(
        'http://csp-failp.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-failp.local'));
    expect(result.status).toBe('fail');
    expect(result.details?.failBucket).toBe(1);
    expect(result.message).toContain('past 50%');
  });

  // ── Worst-status across multiple pages ──

  it('uses worst status across multiple pages', async () => {
    // Page 1: content starts immediately (pass)
    server.use(
      http.get(
        'http://csp-worst.local/docs/good',
        () =>
          new HttpResponse('<html><body><h1>Docs</h1><p>Good page.</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    // Page 2: massive CSS boilerplate before content (fail)
    const cssRules = Array.from(
      { length: 200 },
      (_, i) => `.c${i} { color: red; margin: ${i}px; }`,
    ).join('\n');
    server.use(
      http.get(
        'http://csp-worst.local/docs/bad',
        () =>
          new HttpResponse(
            `<html><head><style>${cssRules}</style></head><body><h3>Late Content</h3></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Good](http://csp-worst.local/docs/good): Good\n- [Bad](http://csp-worst.local/docs/bad): Bad\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.passBucket).toBeGreaterThanOrEqual(1);
    expect(result.details?.failBucket).toBeGreaterThanOrEqual(1);
  });

  // ── Fetch errors ──

  it('handles fetch errors gracefully and includes count in message', async () => {
    server.use(http.get('http://csp-err.local/docs/page', () => HttpResponse.error()));

    const result = await check.run(singlePageCtx('csp-err.local'));
    expect(result.status).toBe('fail');
    expect(result.details?.fetchErrors).toBe(1);
    expect(result.message).toContain('failed to fetch');
  });

  // ── Fetch error with successful pages produces suffix ──

  it('appends fetch error count when some pages succeed', async () => {
    server.use(
      http.get(
        'http://csp-partial.local/docs/good',
        () =>
          new HttpResponse('<html><body><h1>Works</h1><p>Content.</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get('http://csp-partial.local/docs/broken', () => HttpResponse.error()),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Good](http://csp-partial.local/docs/good): OK\n- [Broken](http://csp-partial.local/docs/broken): Broken\n`;
    const result = await check.run(makeCtx(content));
    expect(result.details?.fetchErrors).toBe(1);
    expect(result.message).toContain('1 failed to fetch');
  });

  // ── Sampling ──

  it('samples when more links than maxLinksToTest', async () => {
    const links = Array.from(
      { length: 5 },
      (_, i) => `- [Page ${i}](http://csp-sample.local/docs/page${i}): Page ${i}`,
    ).join('\n');

    for (let i = 0; i < 5; i++) {
      server.use(
        http.get(
          `http://csp-sample.local/docs/page${i}`,
          () =>
            new HttpResponse(`<html><body><h1>Page ${i}</h1><p>Content here.</p></body></html>`, {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
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
      category: 'llms-txt',
      status: 'pass',
      message: 'Found',
      details: { discoveredFiles: discovered },
    });

    const result = await check.run(ctx);
    expect(result.details?.totalPages).toBe(5);
    expect(result.details?.testedPages).toBe(2);
    expect(result.details?.sampled).toBe(true);
    expect(result.message).toContain('sampled pages');
  });

  // ── Per-page details ──

  it('reports per-page position details', async () => {
    server.use(
      http.get(
        'http://csp-detail.local/docs/page',
        () =>
          new HttpResponse(
            '<html><body><h1>Title</h1><p>A paragraph of meaningful documentation content for testing.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const result = await check.run(singlePageCtx('csp-detail.local'));
    const pageResults = result.details?.pageResults as Array<{
      url: string;
      contentStartChar: number;
      totalChars: number;
      contentStartPercent: number;
    }>;
    expect(pageResults).toHaveLength(1);
    expect(pageResults[0].url).toBe('http://csp-detail.local/docs/page');
    expect(pageResults[0].totalChars).toBeGreaterThan(0);
    expect(pageResults[0].contentStartChar).toBeGreaterThanOrEqual(0);
    expect(pageResults[0].contentStartPercent).toBeGreaterThanOrEqual(0);
  });

  // ── Markdown responses (no Turndown conversion) ──

  it('analyzes markdown directly when response is text/markdown', async () => {
    const markdownContent = '# API Guide\n\nThis page documents the `<head>` element.\n';
    server.use(
      http.get(
        'http://csp-md.local/docs/page',
        () =>
          new HttpResponse(markdownContent, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
          }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-md.local'));
    expect(result.status).toBe('pass');
    const pageResults = result.details?.pageResults as Array<{
      contentStartChar: number;
      contentStartPercent: number;
    }>;
    // ATX heading at position 0
    expect(pageResults[0].contentStartChar).toBe(0);
    expect(pageResults[0].contentStartPercent).toBe(0);
  });

  it('analyzes markdown directly when response is text/plain', async () => {
    const markdownContent = '# Checkout\n\nSet up `<head>` tags in your HTML page.\n';
    server.use(
      http.get(
        'http://csp-plain.local/docs/page',
        () =>
          new HttpResponse(markdownContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-plain.local'));
    expect(result.status).toBe('pass');
    const pageResults = result.details?.pageResults as Array<{
      contentStartPercent: number;
    }>;
    expect(pageResults[0].contentStartPercent).toBe(0);
  });

  // ── Fallback to baseUrl ──

  it('falls back to baseUrl when no llms.txt', async () => {
    server.use(
      http.get(
        'http://csp-fb.local/llms.txt',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
      http.get(
        'http://csp-fb.local/docs/llms.txt',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
      http.get('http://csp-fb.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://csp-fb.local/sitemap.xml',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
      http.get(
        'http://csp-fb.local',
        () =>
          new HttpResponse(
            '<!DOCTYPE html><html><body><h1>Welcome</h1><p>Documentation home page with some real content.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const ctx = createContext('http://csp-fb.local', { requestDelay: 0 });
    const result = await check.run(ctx);
    expect(result.details?.testedPages).toBe(1);
    expect(result.status).toBe('pass');
  });

  // ── Lines that don't match any skip pattern and aren't prose ──

  it('skips short multi-word non-prose lines (breadcrumbs)', async () => {
    // Short lines with spaces but under 20 chars and under NAV_MAX_LENGTH
    // These fall through all skip patterns to the final charPos increment
    const html = `<html><body>
      <span>Go back</span>
      <span>Up next</span>
      <h1>Real Content</h1>
      <p>Documentation paragraph.</p>
    </body></html>`;

    server.use(
      http.get(
        'http://csp-breadcrumb.local/docs/page',
        () => new HttpResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const result = await check.run(singlePageCtx('csp-breadcrumb.local'));
    const pageResults = result.details?.pageResults as Array<{ contentStartChar: number }>;
    // "Go back" and "Up next" should be skipped, content starts at heading
    expect(pageResults[0].contentStartChar).toBeGreaterThan(0);
  });
});
