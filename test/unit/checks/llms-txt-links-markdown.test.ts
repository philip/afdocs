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
});
