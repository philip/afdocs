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

  describe('canonical selection', () => {
    const APEX_LLMS_TXT = `# Apex marketing\n\n> Apex.\n\n## Links\n\n- [Blog](http://canon.local/blog/post): Blog\n`;
    const DOCS_LLMS_TXT = `# Docs\n\n> Docs index.\n\n## Links\n\n- [Guide](http://canon.local/docs/guide): Guide\n`;

    it('picks /docs/llms.txt as canonical when baseUrl is the docs path', async () => {
      server.use(
        http.get('http://canon.local/llms.txt', () => HttpResponse.text(APEX_LLMS_TXT)),
        http.get('http://canon.local/docs/llms.txt', () => HttpResponse.text(DOCS_LLMS_TXT)),
      );

      const report = await runChecks('http://canon.local/docs', {
        checkIds: ['llms-txt-exists'],
        requestDelay: 0,
      });

      expect(report.results[0].status).toBe('pass');
      expect(report.results[0].details?.canonicalUrl).toBe('http://canon.local/docs/llms.txt');
      expect(report.results[0].details?.canonicalSource).toBe('heuristic');
      expect(report.results[0].message).toContain('using http://canon.local/docs/llms.txt');
    });

    it('picks the apex llms.txt as canonical when baseUrl is the origin', async () => {
      server.use(
        http.get('http://canon-apex.local/llms.txt', () => HttpResponse.text(APEX_LLMS_TXT)),
        http.get('http://canon-apex.local/docs/llms.txt', () => HttpResponse.text(DOCS_LLMS_TXT)),
      );

      const report = await runChecks('http://canon-apex.local', {
        checkIds: ['llms-txt-exists'],
        requestDelay: 0,
      });

      expect(report.results[0].status).toBe('pass');
      expect(report.results[0].details?.canonicalUrl).toBe('http://canon-apex.local/llms.txt');
    });

    it('omits canonicalSource when only one file is discovered', async () => {
      server.use(
        http.get('http://canon-single.local/llms.txt', () => HttpResponse.text(APEX_LLMS_TXT)),
        http.get(
          'http://canon-single.local/docs/llms.txt',
          () => new HttpResponse(null, { status: 404 }),
        ),
      );

      const report = await runChecks('http://canon-single.local', {
        checkIds: ['llms-txt-exists'],
        requestDelay: 0,
      });

      expect(report.results[0].status).toBe('pass');
      expect(report.results[0].details?.canonicalUrl).toBe('http://canon-single.local/llms.txt');
      expect(report.results[0].details?.canonicalSource).toBeUndefined();
      expect(report.results[0].message).toBe(
        'llms.txt found at http://canon-single.local/llms.txt',
      );
    });
  });

  describe('--llms-txt-url override', () => {
    const VALID = `# Override\n\n> Override docs.\n\n## Links\n\n- [Page](http://override.local/x): X\n`;

    it('probes only the explicit URL and uses it as canonical', async () => {
      server.use(
        // The discovery heuristic would normally hit /llms.txt and /docs/llms.txt,
        // but with the override only the explicit URL is probed.
        http.get('http://override.local/custom/llms.txt', () => HttpResponse.text(VALID)),
      );

      const report = await runChecks('http://override.local', {
        checkIds: ['llms-txt-exists'],
        requestDelay: 0,
        llmsTxtUrl: 'http://override.local/custom/llms.txt',
      });

      expect(report.results[0].status).toBe('pass');
      expect(report.results[0].details?.canonicalUrl).toBe('http://override.local/custom/llms.txt');
      expect(report.results[0].details?.canonicalSource).toBe('explicit');
      expect(report.results[0].message).toContain('specified via --llms-txt-url');
      // candidateUrls should only include the explicit URL
      const candidates = report.results[0].details?.candidateUrls as Array<{ url: string }>;
      expect(candidates).toHaveLength(1);
      expect(candidates[0].url).toBe('http://override.local/custom/llms.txt');
    });

    it('reports an explicit-URL-aware failure when the override 404s', async () => {
      server.use(
        http.get(
          'http://override-missing.local/custom/llms.txt',
          () => new HttpResponse(null, { status: 404 }),
        ),
      );

      const report = await runChecks('http://override-missing.local', {
        checkIds: ['llms-txt-exists'],
        requestDelay: 0,
        llmsTxtUrl: 'http://override-missing.local/custom/llms.txt',
      });

      expect(report.results[0].status).toBe('fail');
      expect(report.results[0].message).toContain('--llms-txt-url');
      expect(report.results[0].message).toContain('http://override-missing.local/custom/llms.txt');
    });
  });
});
