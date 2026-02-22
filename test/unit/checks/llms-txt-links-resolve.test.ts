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

describe('llms-txt-links-resolve', () => {
  const check = getCheck('llms-txt-links-resolve')!;

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

  it('passes when all links resolve', async () => {
    server.use(
      http.head('http://links.local/page1', () => new HttpResponse(null, { status: 200 })),
      http.head('http://links.local/page2', () => new HttpResponse(null, { status: 200 })),
    );

    const content = `# Test
> Summary
## Links
- [Page 1](http://links.local/page1): First
- [Page 2](http://links.local/page2): Second
`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
  });

  it('fails when most links are broken', async () => {
    server.use(
      http.head('http://broken.local/page1', () => new HttpResponse(null, { status: 404 })),
      http.head('http://broken.local/page2', () => new HttpResponse(null, { status: 404 })),
      http.head('http://broken.local/page3', () => new HttpResponse(null, { status: 200 })),
    );

    const content = `# Test
> Summary
## Links
- [Page 1](http://broken.local/page1): First
- [Page 2](http://broken.local/page2): Second
- [Page 3](http://broken.local/page3): Third
`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
  });

  it('skips when no HTTP links present', async () => {
    const content = `# Test
> Summary
## Links
Just text, no links.
`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('skip');
  });
});
