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

  it('does not treat a longer fence line carrying an info string as a closer', async () => {
    // Per CommonMark §4.5, a closing fence "may not be followed by
    // anything other than spaces and tabs" — i.e. it cannot have an
    // info string. Inside an open fence, a longer line that looks like
    // a fence opener (more backticks plus an info string) is just text,
    // not a closer; the next bare matching fence line is the closer.
    //
    // Realistic case: a docs page explains fence syntax to readers, and
    // its prose includes a line starting with four backticks as the
    // illustrated syntax.
    const md = [
      '```', // opens the outer fence
      'In GitHub-flavored markdown you can attach attributes to a fence:',
      '````md filename="example.md"', // looks like a fence, but is prose inside the open fence
      'The closing fence matches the opening fence length, with no info.',
      '```', // closes the outer fence
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
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

  it('handles fences indented inside list items', async () => {
    // Common docs pattern: a numbered/bulleted step contains a fenced code
    // block, which the author indents to align with the list-item content
    // column. Per CommonMark §4.5 the opener may itself be indented up to
    // 3 spaces; the closer must be the same fence char and at least the
    // same length, with up to 3 spaces of its own indent.
    //
    // Our regex caps fence indent at 3 spaces, but list-item content is
    // typically indented 2-4 spaces. Real-world authoring tools (and the
    // CommonMark reference parser) interpret a fence whose indent matches
    // the list-item content column as a fence belonging to the list item.
    //
    // We don't model list structure, so we just need fences indented up to
    // 3 spaces to be detected. Anything more deeply indented is treated as
    // an indented code block (correct per spec).
    const md = [
      '1. First step:',
      '',
      '   ```bash',
      '   echo "hello"',
      '   ```',
      '',
      '2. Second step.',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('detects fences inside two-digit ordered list items (4-space content column)', async () => {
    // "10. " puts the list-item content column at 4. Per CommonMark, a fence
    // inside that list item inherits the 4-space content indent — the fence
    // line "    ```" is a fence, not an indented code block. Tutorial-style
    // docs (e.g. multi-step procedures with 10+ steps) hit this regularly.
    const md = [
      '10. First step:',
      '',
      '    ```bash',
      '    echo "hello"',
      '    ```',
      '',
      '11. Second step.',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('detects fences inside nested unordered list items', async () => {
    // Outer list: content column 2. Inner nested list: content column 4.
    // A fence inside the nested item inherits indent 4.
    const md = [
      '- Outer item:',
      '  - Nested step:',
      '',
      '    ```js',
      '    console.log("hi");',
      '    ```',
      '',
      '- Another outer item.',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('detects unclosed fence inside a deeply-indented list item', async () => {
    // Inverse: a real authoring bug at 4-space indent should still be flagged.
    const md = [
      '10. First step:',
      '',
      '    ```bash',
      '    echo "hello"',
      '',
      '11. Second step (fence above is unclosed).',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.unclosedCount).toBe(1);
  });

  it('still treats top-level 4-space-indented backticks as indented code blocks', async () => {
    // Outside any list/blockquote context, a line with 4 spaces of indent is
    // an indented code block per CommonMark §4.4 — not a fence. Don't let
    // the list-aware widening introduce false positives here.
    const md = [
      'Some prose.',
      '',
      '    ```',
      '    not a fence — this is an indented code block',
      '    ```',
      '',
      'More prose.',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(0);
  });

  it('accepts backticks in a backtick-fence info string (known minor divergence)', async () => {
    // Per CommonMark §4.5, a backtick-fence opener's info string may not
    // contain a backtick (otherwise the line is parsed as inline code, not
    // a fence). We don't enforce this — we treat ```foo`bar as a valid
    // opener. The failure mode is benign (we accept what CommonMark
    // rejects) and the pattern is genuinely rare in real docs.
    //
    // Pin current behavior so any future change is deliberate.
    const md = ['```foo`bar', 'content', '```'].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
  });

  it('treats fences inside <details> HTML blocks as fences (GFM-compatible)', async () => {
    // Strict CommonMark says a Type 6 HTML block (e.g. opened by <details>)
    // doesn't parse markdown inside it, so ``` would be literal text. But
    // GFM, MDX, and most docs renderers (including MongoDB's) DO parse
    // markdown inside <details>, and authors rely on that. We follow GFM
    // here: ``` inside <details> is a fence.
    //
    // Pin current behavior so a future "strict CommonMark" pass doesn't
    // accidentally regress this.
    const md = [
      '<details>',
      '<summary>Click me</summary>',
      '',
      '```js',
      'console.log("inside details");',
      '```',
      '',
      '</details>',
    ].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('does not treat tab-indented backticks as a fence (per CommonMark indent rules)', async () => {
    // Per CommonMark §4.5, a fence may be indented 0-3 spaces. A leading tab
    // expands to 4 spaces of indent, which exceeds the limit — making
    // \t``` an indented code block, not a fence. This test pins the
    // current (correct) behavior so a future regex relaxation can't
    // silently start matching tab-indented fences.
    const md = ['Some prose.', '', '\t```', '\tnot a fence', '\t```', '', 'More prose.'].join('\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(0);
  });

  it('handles CRLF line endings (Windows-authored docs)', async () => {
    // Docs authored on Windows or saved through CRLF-preserving tooling can
    // arrive with \r\n line endings. The fence regex must still match, or
    // we silently undercount fences and miss real unclosed-fence bugs.
    const md = ['# Hello', '', '```js', 'console.log("hi");', '```', ''].join('\r\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.totalFences).toBe(1);
    expect(result.details?.unclosedCount).toBe(0);
  });

  it('detects unclosed fences with CRLF line endings', async () => {
    // Inverse of the previous test: an unclosed fence in CRLF content must
    // still be flagged, not silently swallowed.
    const md = ['# Hello', '', '```js', 'console.log("hi");', 'no closer'].join('\r\n');
    const result = await check.run(
      makeCtx([{ url: 'http://test.local/page1', content: md, source: 'md-url' }]),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.unclosedCount).toBe(1);
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
