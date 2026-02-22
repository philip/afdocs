import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { runChecks } from '../../../src/runner.js';
import '../../../src/checks/index.js';

const VALID_LLMS_TXT = `# Test Project

> Test Project is a testing tool.

## Docs

- [Guide](http://localhost:9999/guide): A guide
`;

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('llms-txt-exists', () => {
  it('passes when llms.txt exists at base URL', async () => {
    server.use(
      http.get('http://test.local/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get('http://test.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://test.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('pass');
    expect(report.results[0].details?.discoveredFiles).toHaveLength(1);
  });

  it('fails when llms.txt not found anywhere', async () => {
    server.use(
      http.get('http://notfound.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get(
        'http://notfound.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const report = await runChecks('http://notfound.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('fail');
  });

  it('discovers llms.txt at /docs/ path', async () => {
    server.use(
      http.get('http://docsonly.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get('http://docsonly.local/docs/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
    );

    const report = await runChecks('http://docsonly.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('pass');
  });

  it('rejects HTML responses', async () => {
    server.use(
      http.get('http://html.local/llms.txt', () =>
        HttpResponse.html('<html><body>Not found</body></html>'),
      ),
      http.get('http://html.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://html.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('fail');
  });
});
