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

describe('tabbed-content-serialization', () => {
  const check = getCheck('tabbed-content-serialization')!;

  function makeCtx(content?: string, opts?: Record<string, unknown>) {
    const ctx = createContext('http://test.local', { requestDelay: 0, ...opts });

    if (content) {
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

  it('passes when page has no tabbed content', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse('<html><body><h1>Hello</h1><p>No tabs here.</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.message).toContain('No tabbed content');
  });

  it('passes when tabbed content serializes under threshold', async () => {
    const tabHtml = `
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">Python</div>
        <div class="sphinx-tabs-tab">JS</div>
        <div class="sphinx-tabs-panel"><pre>print("hi")</pre></div>
        <div class="sphinx-tabs-panel"><pre>console.log("hi")</pre></div>
      </div>
    `;
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(`<html><body>${tabHtml}</body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.details?.totalGroupsFound).toBe(1);
    expect(result.details?.pagesWithTabs).toBe(1);
  });

  it('fails when tabbed content exceeds 100K chars', async () => {
    // Create large tab panels that serialize to over 100K
    const bigPanel = '<p>' + 'x'.repeat(60_000) + '</p>';
    const tabHtml = `
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">A</div>
        <div class="sphinx-tabs-tab">B</div>
        <div class="sphinx-tabs-panel">${bigPanel}</div>
        <div class="sphinx-tabs-panel">${bigPanel}</div>
      </div>
    `;
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(`<html><body>${tabHtml}</body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.message).toContain('over 100K');
  });

  it('handles fetch errors gracefully', async () => {
    server.use(http.get('http://test.local/docs/page1', () => HttpResponse.error()));

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('skips conversion for markdown responses', async () => {
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse('# Hello\n\nNo tabs in markdown.', {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    const tabbedPages = result.details?.tabbedPages as Array<{ totalTabbedChars: number }>;
    expect(tabbedPages[0].totalTabbedChars).toBe(0);
  });

  it('stores tabbedPages in details for downstream checks', async () => {
    const tabHtml = `
      <div class="tabbed-set">
        <div class="tabbed-labels"><label>Go</label></div>
        <div class="tabbed-content"><div class="tabbed-block"><pre>fmt.Println</pre></div></div>
      </div>
    `;
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(`<html><body>${tabHtml}</body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.details?.tabbedPages).toBeDefined();
    const tabbedPages = result.details?.tabbedPages as Array<{
      url: string;
      tabGroups: Array<{ framework: string }>;
    }>;
    expect(tabbedPages[0].tabGroups[0].framework).toBe('mkdocs');
  });

  it('detects MDX tabs in markdown responses', async () => {
    const mdContent = `# Guide\n\n<Tabs>\n<Tab name="Python">\n\npip install foo\n\n</Tab>\n<Tab name="Node">\n\nnpm install foo\n\n</Tab>\n</Tabs>\n`;
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(mdContent, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    const tabbedPages = result.details?.tabbedPages as Array<{
      tabGroups: Array<{ framework: string }>;
      source: string;
    }>;
    expect(tabbedPages[0].tabGroups).toHaveLength(1);
    expect(tabbedPages[0].tabGroups[0].framework).toBe('mdx');
    expect(tabbedPages[0].source).toBe('markdown');
  });

  it('falls back to .md URL when HTML is an SPA shell', async () => {
    // SPA shell: large HTML with minimal text content
    const spaHtml =
      '<html><head><style>' +
      'x'.repeat(15_000) +
      '</style></head><body><div id="___gatsby"></div></body></html>';
    const mdContent = `# Tutorial\n\n<Tabs>\n<Tab name="Atlas">Atlas content</Tab>\n<Tab name="Local">Local content</Tab>\n</Tabs>\n`;

    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(spaHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        'http://test.local/docs/page1.md',
        () =>
          new HttpResponse(mdContent, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const ctx = makeCtx(content);
    // Simulate rendering-strategy having flagged this URL as an SPA shell
    ctx.previousResults.set('rendering-strategy', {
      id: 'rendering-strategy',
      category: 'page-size',
      status: 'fail',
      message: 'SPA shell detected',
      details: {
        pageResults: [{ url: 'http://test.local/docs/page1', status: 'fail' }],
      },
    });
    const result = await check.run(ctx);
    const tabbedPages = result.details?.tabbedPages as Array<{
      tabGroups: Array<{ framework: string }>;
      source: string;
    }>;
    expect(tabbedPages[0].tabGroups).toHaveLength(1);
    expect(tabbedPages[0].tabGroups[0].framework).toBe('mdx');
    expect(tabbedPages[0].source).toBe('md-fallback');
  });

  it('warns when tabbed content is between 50K-100K chars', async () => {
    // Create tab panels that serialize to ~75K chars in markdown
    const panelContent = '<p>' + 'w'.repeat(37_000) + '</p>';
    const tabHtml = `
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">Alpha</div>
        <div class="sphinx-tabs-tab">Beta</div>
        <div class="sphinx-tabs-panel">${panelContent}</div>
        <div class="sphinx-tabs-panel">${panelContent}</div>
      </div>
    `;
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(`<html><body>${tabHtml}</body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('warn');
    expect(result.message).toContain('50K–100K');
  });

  it('includes fetch errors in message when tabs are found', async () => {
    const tabHtml = `
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">Python</div>
        <div class="sphinx-tabs-tab">JS</div>
        <div class="sphinx-tabs-panel"><pre>print("hi")</pre></div>
        <div class="sphinx-tabs-panel"><pre>console.log("hi")</pre></div>
      </div>
    `;
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(`<html><body>${tabHtml}</body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get('http://test.local/docs/page2', () => HttpResponse.error()),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n- [Page 2](http://test.local/docs/page2): Second\n`;
    const result = await check.run(makeCtx(content));
    expect(result.message).toContain('1 failed to fetch');
    expect(result.details?.fetchErrors).toBe(1);
    // Should still have found the tab groups from the successful page
    expect(result.details?.totalGroupsFound).toBeGreaterThan(0);
  });

  it('SPA shell falls through when tryMdFallback returns null (all candidates fail)', async () => {
    const spaHtml =
      '<html><head><style>' +
      'x'.repeat(15_000) +
      '</style></head><body><div id="___gatsby"></div></body></html>';

    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(spaHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      // .md candidate returns 404 so tryMdFallback returns null
      http.get(
        'http://test.local/docs/page1.md',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
      http.get(
        'http://test.local/docs/page1/index.md',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const ctx = makeCtx(content);
    ctx.previousResults.set('rendering-strategy', {
      id: 'rendering-strategy',
      category: 'page-size',
      status: 'fail',
      message: 'SPA shell detected',
      details: {
        pageResults: [{ url: 'http://test.local/docs/page1', status: 'fail' }],
      },
    });
    const result = await check.run(ctx);
    expect(result.details?.totalGroupsFound).toBe(0);
    const tabbedPages = result.details?.tabbedPages as Array<{
      tabGroups: Array<unknown>;
      source: string;
    }>;
    expect(tabbedPages[0].tabGroups).toHaveLength(0);
    // tryMdFallback returned null, so falls through to default html source
    expect(tabbedPages[0].source).toBe('html');
  });

  it('does not try .md fallback for non-SPA HTML', async () => {
    // Regular server-rendered HTML with no tabs
    server.use(
      http.get(
        'http://test.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><h1>Hello</h1><p>' + 'Real content. '.repeat(100) + '</p></body></html>',
            {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            },
          ),
      ),
      // This .md URL has tabs, but should NOT be fetched
      http.get(
        'http://test.local/docs/page1.md',
        () =>
          new HttpResponse('<Tabs><Tab name="A">A</Tab></Tabs>', {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
    );

    const content = `# Docs\n> Summary\n## Links\n- [Page 1](http://test.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.message).toContain('No tabbed content');
    const tabbedPages = result.details?.tabbedPages as Array<{ source: string }>;
    expect(tabbedPages[0].source).toBe('html');
  });
});
