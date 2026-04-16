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

describe('markdown-code-fence-validity', () => {
  const check = getCheck('markdown-code-fence-validity')!;

  /**
   * Create a context that simulates dependency checks having run.
   * Pages go into pageCache; llms.txt files go into previousResults.
   * Also sets a markdown-url-support result so the check knows deps ran.
   */
  function makeCtx(
    pages?: Array<{ url: string; content: string; source: 'md-url' | 'content-negotiation' }>,
    llmsTxtFiles?: DiscoveredFile[],
  ) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });

    // Populate pageCache
    if (pages) {
      for (const page of pages) {
        ctx.pageCache.set(page.url, {
          url: page.url,
          markdown: { content: page.content, source: page.source },
        });
      }
    }

    // Mark that the dependency check ran so we use cached content path
    ctx.previousResults.set('markdown-url-support', {
      id: 'markdown-url-support',
      category: 'markdown-availability',
      status: pages && pages.length > 0 ? 'pass' : 'fail',
      message: 'test',
    });

    // Populate llms-txt-exists result
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'content-discoverability',
      status: llmsTxtFiles ? 'pass' : 'fail',
      message: llmsTxtFiles ? 'Found' : 'Not found',
      details: { discoveredFiles: llmsTxtFiles ?? [] },
    });
    if (llmsTxtFiles) {
      mockSitemapNotFound(server, 'http://test.local');
    }

    return ctx;
  }

  it('passes when all fences are properly closed', async () => {
    const md =
      '# Hello\n\n```js\nconsole.log("hi");\n```\n\nMore text\n\n~~~python\nprint("hi")\n~~~\n';
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(2);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('fails when a fence is unclosed', async () => {
    const md = '# Hello\n\n```js\nconsole.log("hi");\n\nMore text\n';
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.unclosedCount).toBe(1);
    const pageResults = result.details?.pageResults as Array<{
      issues: Array<{ line: number; type: string }>;
    }>;
    expect(pageResults[0].issues[0].line).toBe(3);
    expect(pageResults[0].issues[0].type).toBe('unclosed');
  });

  it('treats mismatched delimiter type as unclosed (not inconsistent close)', async () => {
    // Per CommonMark, ~~~ does not close a ``` fence — the fence remains open
    const md = '# Hello\n\n```js\nconsole.log("hi");\n~~~\n\nMore text\n';
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.unclosedCount).toBe(1);
  });

  it('allows valid cross-type nesting (backtick fence containing tilde fence)', async () => {
    // A ``` fence can contain ~~~ fences because they are different delimiter types
    const md = [
      '# Example',
      '',
      '```markdown',
      'Some content with an inner code block:',
      '~~~css',
      ':root { --color: red; }',
      '~~~',
      'More content.',
      '```',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('skips when dependency ran but no markdown was cached', async () => {
    const result = await check.run(makeCtx());
    expect(result.status).toBe('skip');
    expect(result.message).toContain('does not serve markdown');
  });

  it('analyzes llms.txt content too', async () => {
    const llmsContent = '# Docs\n\n```\ncode block\n```\n';
    const result = await check.run(
      makeCtx(undefined, [
        { url: 'http://test.local/llms.txt', content: llmsContent, status: 200, redirected: false },
      ]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.pagesAnalyzed).toBe(1);
  });

  it('handles multiple pages with mixed results', async () => {
    const goodMd = '# Good\n\n```\ncode\n```\n';
    const badMd = '# Bad\n\n```\nunclosed\n';
    const result = await check.run(
      makeCtx([
        { url: 'http://test.local/good', content: goodMd, source: 'md-url' },
        { url: 'http://test.local/bad', content: badMd, source: 'md-url' },
      ]),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.unclosedCount).toBe(1);
    expect(result.details?.pagesAnalyzed).toBe(2);
  });

  it('handles content with no code fences', async () => {
    const md = '# Hello\n\nJust regular markdown with no fences.\n';
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(0);
  });

  it('ignores fences inside markdown table cells', async () => {
    // Table cells with code fences are a vendor extension, not CommonMark
    const md = [
      '# API Response',
      '',
      '| Before | After |',
      '| --- | --- |',
      '| ```',
      '  old: true',
      '  ``` | ```',
      '  new: true',
      '  ``` |',
      '',
      'Some text.',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(0);
  });

  it('handles nested-looking fences correctly', async () => {
    // A 4-backtick fence containing a 3-backtick fence
    const md = '# Hello\n\n````\n```\ninner\n```\n````\n';
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
  });

  it('handles fences inside blockquotes', async () => {
    const md = [
      '# Guide',
      '',
      '> Note:',
      '> ',
      '> ```bash',
      '> echo "hello"',
      '> ```',
      '',
      'More text',
      '',
      '```js',
      'console.log("hi");',
      '```',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(2);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('handles blockquote fences with lazy continuation (no > on content lines)', async () => {
    // Real-world pattern: opener has "> " but content and closer don't
    const md = [
      '> Warning:',
      '> ',
      '> ```',
      'W: An error occurred during verification.',
      'W: Failed to fetch packages.',
      '```',
      '',
      'Regular text here.',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('handles nested blockquote fences', async () => {
    const md = ['> > ```', '> > nested code', '> > ```'].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
  });

  it('fetches markdown in standalone mode when dependencies did not run', async () => {
    const mdContent = '# Standalone\n\n```js\nconsole.log("hi");\n```\n';
    server.use(
      http.get(
        'http://mcfv-standalone.local/llms.txt',
        () =>
          new HttpResponse(
            `# Docs\n## Links\n- [Page](http://mcfv-standalone.local/docs/page): A page\n`,
            {
              status: 200,
              headers: { 'Content-Type': 'text/plain' },
            },
          ),
      ),
      http.get(
        'http://mcfv-standalone.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get(
        'http://mcfv-standalone.local/docs/page.md',
        () =>
          new HttpResponse(mdContent, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
      http.get(
        'http://mcfv-standalone.local/docs/page/index.md',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    mockSitemapNotFound(server, 'http://mcfv-standalone.local');

    // No dependency results set — standalone mode
    const ctx = createContext('http://mcfv-standalone.local', { requestDelay: 0 });
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.pagesAnalyzed).toBeGreaterThanOrEqual(1);
  });

  it('returns helpful skip message in standalone mode when no markdown found', async () => {
    server.use(
      http.get('http://mcfv-nomd.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get(
        'http://mcfv-nomd.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get('http://mcfv-nomd.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://mcfv-nomd.local/sitemap.xml', () => new HttpResponse('', { status: 404 })),
      // Catch-all: site only serves HTML
      http.get(
        'http://mcfv-nomd.local/*',
        () =>
          new HttpResponse('<html><body>HTML only</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        'http://mcfv-nomd.local',
        () =>
          new HttpResponse('<html><body>HTML only</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = createContext('http://mcfv-nomd.local', { requestDelay: 0 });
    const result = await check.run(ctx);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('markdown-url-support');
  });
});
