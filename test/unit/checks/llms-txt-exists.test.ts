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

  it('rejects uppercase HTML responses', async () => {
    server.use(
      http.get(
        'http://uphtml.local/llms.txt',
        () =>
          new HttpResponse('<HTML><BODY>Not found</BODY></HTML>', {
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get('http://uphtml.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://uphtml.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('fail');
  });

  it('warns when llms.txt only reachable via cross-host redirect', async () => {
    server.use(
      http.get('http://xhost.local/llms.txt', () =>
        HttpResponse.redirect('http://other.host/llms.txt', 301),
      ),
      http.get('http://other.host/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get('http://xhost.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://xhost.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('warn');
    expect(report.results[0].message).toContain('cross-host redirect');
  });

  it('detects multiple locations with different content', async () => {
    const altContent = `# Alt Project\n\n> Different content.\n`;
    server.use(
      http.get('http://multi.local/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get('http://multi.local/docs/llms.txt', () => HttpResponse.text(altContent)),
    );

    const report = await runChecks('http://multi.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('pass');
    expect(report.results[0].details?.multipleLocations).toBe(true);
    expect(report.results[0].details?.sameContent).toBe(false);
    expect(report.results[0].details?.discoveredFiles).toHaveLength(2);
  });

  it('detects multiple locations with same content', async () => {
    server.use(
      http.get('http://same.local/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get('http://same.local/docs/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
    );

    const report = await runChecks('http://same.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('pass');
    expect(report.results[0].details?.multipleLocations).toBe(true);
    expect(report.results[0].details?.sameContent).toBe(true);
  });

  it('reports fetch errors in details and message', async () => {
    server.use(
      http.get('http://fetcherr.local/llms.txt', () => HttpResponse.error()),
      http.get('http://fetcherr.local/docs/llms.txt', () => HttpResponse.error()),
    );

    const report = await runChecks('http://fetcherr.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('fail');
    expect(report.results[0].details?.fetchErrors).toBe(2);
    expect(report.results[0].message).toContain('failed to fetch');
  });

  it('warns when cross-host redirect and llms.txt found at redirected origin', async () => {
    server.use(
      // Original candidate redirects cross-host, but the redirected path 404s
      http.get('http://redir.local/llms.txt', () =>
        HttpResponse.redirect('http://newhost.local/docs/llms.txt', 301),
      ),
      http.get('http://newhost.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
      // Fallback: {redirected_origin}/llms.txt exists
      http.get('http://newhost.local/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get('http://redir.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://redir.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('warn');
    expect(report.results[0].message).toContain('cross-host redirect');
    expect(report.results[0].details?.redirectedOrigins).toContain('http://newhost.local');
  });

  it('fails with redirect note when cross-host redirect and no llms.txt anywhere', async () => {
    server.use(
      http.get('http://noredir.local/llms.txt', () =>
        HttpResponse.redirect('http://gone.local/llms.txt', 301),
      ),
      http.get('http://gone.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get('http://noredir.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://noredir.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('fail');
    expect(report.results[0].message).toContain('cross-host');
    expect(report.results[0].message).toContain('http://gone.local');
  });

  it('reports rate-limited candidates (HTTP 429)', async () => {
    server.use(
      http.get(
        'http://ratelimit.local/llms.txt',
        () => new HttpResponse('Too Many Requests', { status: 429 }),
      ),
      http.get(
        'http://ratelimit.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const report = await runChecks('http://ratelimit.local', {
      checkIds: ['llms-txt-exists'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('fail');
    expect(report.results[0].details?.rateLimited).toBe(1);
    expect(report.results[0].message).toContain('rate-limited (HTTP 429)');
  });
});
