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

describe('llms-txt-links-markdown', () => {
  const check = getCheck('llms-txt-links-markdown')!;

  function makeCtx(content: string) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });
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
    return ctx;
  }

  it('passes when links have .md extensions', async () => {
    const content = `# Test
> Summary
## Links
- [Page 1](http://md.local/page1.md): First
- [Page 2](http://md.local/page2.md): Second
`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.details?.markdownRate).toBe(100);
  });

  it('fails when links are HTML with no markdown alternatives', async () => {
    server.use(
      http.head(
        'http://html.local/page1',
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
      http.head('http://html.local/page1.md', () => new HttpResponse(null, { status: 404 })),
      http.head(
        'http://html.local/page2',
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
      http.head('http://html.local/page2.md', () => new HttpResponse(null, { status: 404 })),
    );

    const content = `# Test
> Summary
## Links
- [Page 1](http://html.local/page1): First
- [Page 2](http://html.local/page2): Second
`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
  });

  it('warns when .md variants are available', async () => {
    server.use(
      http.head(
        'http://variant.local/page1',
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
      http.head('http://variant.local/page1.md', () => new HttpResponse(null, { status: 200 })),
    );

    const content = `# Test
> Summary
## Links
- [Page 1](http://variant.local/page1): First
`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('warn');
  });

  it('reports fetch errors in details and message', async () => {
    server.use(
      http.head('http://err-md.local/page1', () => HttpResponse.error()),
      http.get('http://err-md.local/page1', () => HttpResponse.error()),
    );

    const content = `# Test\n> Summary\n## Links\n- [Page 1](http://err-md.local/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.details?.fetchErrors).toBe(1);
    expect(result.message).toContain('failed to fetch');
  });

  it('reports rate-limited results (HTTP 429)', async () => {
    server.use(
      http.head('http://rl-md.local/page1', () => new HttpResponse(null, { status: 429 })),
    );

    const content = `# Test\n> Summary\n## Links\n- [Page 1](http://rl-md.local/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.details?.rateLimited).toBe(1);
    expect(result.message).toContain('rate-limited (HTTP 429)');
  });

  it('includes "sampled" in message when results are sampled', async () => {
    const links = Array.from(
      { length: 5 },
      (_, i) => `- [Page ${i}](http://sample-md.local/page${i}.md): Page ${i}`,
    ).join('\n');

    const content = `# Test\n> Summary\n## Links\n${links}\n`;
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
    expect(result.details?.sampled).toBe(true);
    expect(result.message).toContain('sampled links');
  });

  it('uses toMdUrls to find .md variants (handles trailing slash and .html)', async () => {
    server.use(
      http.head(
        'http://tomd.local/guide.html',
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      ),
      // toMdUrls should produce /guide.md (stripping .html)
      http.head('http://tomd.local/guide.md', () => new HttpResponse(null, { status: 200 })),
    );

    const content = `# Test\n> Summary\n## Links\n- [Guide](http://tomd.local/guide.html): Guide\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('warn');
    expect(result.details?.mdVariantsAvailable).toBe(1);
  });
});
