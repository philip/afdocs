import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  getPageUrls,
  discoverAndSamplePages,
  parseSitemapUrls,
  parseSitemapDirectives,
} from '../../../src/helpers/get-page-urls.js';
import { MAX_SITEMAP_URLS } from '../../../src/constants.js';
import { createContext } from '../../../src/runner.js';
import type { DiscoveredFile } from '../../../src/types.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('parseSitemapUrls', () => {
  it('extracts <loc> URLs from a regular sitemap', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page1</loc></url>
  <url><loc>https://example.com/page2</loc></url>
</urlset>`;

    const result = parseSitemapUrls(xml);
    expect(result.urls).toEqual(['https://example.com/page1', 'https://example.com/page2']);
    expect(result.sitemapIndexUrls).toEqual([]);
  });

  it('extracts sub-sitemap URLs from a sitemap index', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
</sitemapindex>`;

    const result = parseSitemapUrls(xml);
    expect(result.urls).toEqual([]);
    expect(result.sitemapIndexUrls).toEqual([
      'https://example.com/sitemap-pages.xml',
      'https://example.com/sitemap-blog.xml',
    ]);
  });

  it('handles malformed XML gracefully', () => {
    const result = parseSitemapUrls('this is not xml at all');
    expect(result.urls).toEqual([]);
    expect(result.sitemapIndexUrls).toEqual([]);
  });

  it('handles empty sitemap', () => {
    const xml = `<?xml version="1.0"?><urlset></urlset>`;
    const result = parseSitemapUrls(xml);
    expect(result.urls).toEqual([]);
    expect(result.sitemapIndexUrls).toEqual([]);
  });
});

describe('parseSitemapDirectives', () => {
  it('extracts Sitemap URLs from robots.txt', () => {
    const robotsTxt = `User-agent: *
Disallow: /admin

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-blog.xml
`;
    expect(parseSitemapDirectives(robotsTxt)).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap-blog.xml',
    ]);
  });

  it('handles case-insensitive directive', () => {
    expect(parseSitemapDirectives('sitemap: https://example.com/map.xml\n')).toEqual([
      'https://example.com/map.xml',
    ]);
  });

  it('returns empty array when no Sitemap directives', () => {
    expect(parseSitemapDirectives('User-agent: *\nDisallow: /\n')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(parseSitemapDirectives('')).toEqual([]);
  });
});

describe('getPageUrls', () => {
  function makeCtx(baseUrl = 'http://test.local', llmsTxtContent?: string) {
    const ctx = createContext(baseUrl, { requestDelay: 0 });

    if (llmsTxtContent) {
      const discovered: DiscoveredFile[] = [
        { url: `${baseUrl}/llms.txt`, content: llmsTxtContent, status: 200, redirected: false },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'llms-txt',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
    } else {
      // Mark llms-txt-exists as having run (but failed) so getPageUrls
      // skips the direct llms.txt fetch and falls through to sitemap.
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

  it('returns llms.txt links when available (no sitemap fetch)', async () => {
    const content = `# Docs\n> Summary\n## Links\n- [Page](http://test.local/docs/page): A page\n`;
    const ctx = makeCtx('http://test.local', content);

    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://test.local/docs/page']);
    expect(result.warnings).toEqual([]);
  });

  it('fetches and parses sitemap.xml when no llms.txt links', async () => {
    server.use(
      http.get(
        'http://sitemap-test.local/robots.txt',
        () => new HttpResponse('User-agent: *\nDisallow:\n', { status: 200 }),
      ),
      http.get(
        'http://sitemap-test.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://sitemap-test.local/docs/intro</loc></url>
  <url><loc>http://sitemap-test.local/docs/guide</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://sitemap-test.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://sitemap-test.local/docs/intro',
      'http://sitemap-test.local/docs/guide',
    ]);
  });

  it('handles sitemap index files (follows sub-sitemaps)', async () => {
    server.use(
      http.get('http://index-test.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://index-test.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>http://index-test.local/sitemap-docs.xml</loc></sitemap>
</sitemapindex>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
      http.get(
        'http://index-test.local/sitemap-docs.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://index-test.local/docs/a</loc></url>
  <url><loc>http://index-test.local/docs/b</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://index-test.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://index-test.local/docs/a',
      'http://index-test.local/docs/b',
    ]);
  });

  it('filters sitemap URLs to same-origin only', async () => {
    server.use(
      http.get('http://origin-test.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://origin-test.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://origin-test.local/docs/page</loc></url>
  <url><loc>http://other-domain.com/page</loc></url>
  <url><loc>http://origin-test.local/docs/another</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://origin-test.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://origin-test.local/docs/page',
      'http://origin-test.local/docs/another',
    ]);
  });

  it('falls back to baseUrl when both llms.txt and sitemap are empty', async () => {
    server.use(
      http.get('http://empty-test.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://empty-test.local/sitemap.xml',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const ctx = makeCtx('http://empty-test.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://empty-test.local']);
  });

  it('handles malformed sitemap XML gracefully', async () => {
    server.use(
      http.get('http://bad-xml.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://bad-xml.local/sitemap.xml',
        () =>
          new HttpResponse('this is garbage, not xml', {
            status: 200,
            headers: { 'Content-Type': 'application/xml' },
          }),
      ),
    );

    const ctx = makeCtx('http://bad-xml.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://bad-xml.local']);
  });

  it('respects MAX_SITEMAP_URLS cap', async () => {
    const locs = Array.from(
      { length: MAX_SITEMAP_URLS + 100 },
      (_, i) => `  <url><loc>http://big-sitemap.local/page/${i}</loc></url>`,
    ).join('\n');

    server.use(
      http.get('http://big-sitemap.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://big-sitemap.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs}\n</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://big-sitemap.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toHaveLength(MAX_SITEMAP_URLS);
  });

  it('handles sitemap fetch network errors gracefully', async () => {
    server.use(
      http.get('http://net-err.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://net-err.local/sitemap.xml', () => HttpResponse.error()),
    );

    const ctx = makeCtx('http://net-err.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://net-err.local']);
  });

  it('uses sitemap URL from robots.txt Sitemap directive', async () => {
    server.use(
      http.get(
        'http://robots-sm.local/robots.txt',
        () =>
          new HttpResponse(
            'User-agent: *\nDisallow:\n\nSitemap: http://robots-sm.local/my-sitemap.xml\n',
            { status: 200 },
          ),
      ),
      http.get(
        'http://robots-sm.local/my-sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://robots-sm.local/from-robots</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://robots-sm.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://robots-sm.local/from-robots']);
  });

  it('follows multiple Sitemap directives from robots.txt', async () => {
    server.use(
      http.get(
        'http://multi-sm.local/robots.txt',
        () =>
          new HttpResponse(
            'Sitemap: http://multi-sm.local/sitemap-docs.xml\nSitemap: http://multi-sm.local/sitemap-blog.xml\n',
            { status: 200 },
          ),
      ),
      http.get(
        'http://multi-sm.local/sitemap-docs.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://multi-sm.local/docs/a</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
      http.get(
        'http://multi-sm.local/sitemap-blog.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://multi-sm.local/blog/post1</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://multi-sm.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://multi-sm.local/docs/a',
      'http://multi-sm.local/blog/post1',
    ]);
  });

  it('falls back to /sitemap.xml when robots.txt has no Sitemap directive', async () => {
    server.use(
      http.get(
        'http://no-directive.local/robots.txt',
        () => new HttpResponse('User-agent: *\nDisallow: /admin\n', { status: 200 }),
      ),
      http.get(
        'http://no-directive.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://no-directive.local/page</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://no-directive.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://no-directive.local/page']);
  });

  it('warns and skips gzipped sitemap from robots.txt', async () => {
    server.use(
      http.get(
        'http://gz-robots.local/robots.txt',
        () => new HttpResponse('Sitemap: http://gz-robots.local/sitemap.xml.gz\n', { status: 200 }),
      ),
    );

    const ctx = makeCtx('http://gz-robots.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://gz-robots.local']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gzipped sitemap');
    expect(result.warnings[0]).toContain('sitemap.xml.gz');
  });

  it('warns and skips gzipped sub-sitemap from sitemap index', async () => {
    server.use(
      http.get('http://gz-index.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://gz-index.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>http://gz-index.local/sitemap-docs.xml.gz</loc></sitemap>
</sitemapindex>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://gz-index.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://gz-index.local']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('sitemap-docs.xml.gz');
  });

  // ── Direct llms.txt fetch (standalone mode) ──

  it('fetches llms.txt directly when llms-txt-exists has not run', async () => {
    const llmsTxt = `# Docs\n> Summary\n## Links\n- [Intro](http://direct-llms.local/docs/intro): Intro\n- [Guide](http://direct-llms.local/docs/guide): Guide\n`;
    server.use(
      http.get(
        'http://direct-llms.local/llms.txt',
        () => new HttpResponse(llmsTxt, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      ),
      http.get(
        'http://direct-llms.local/docs/llms.txt',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
    );

    // No llms-txt-exists in previousResults → standalone mode
    const ctx = createContext('http://direct-llms.local', { requestDelay: 0 });
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://direct-llms.local/docs/intro',
      'http://direct-llms.local/docs/guide',
    ]);
  });

  it('skips llms.txt with non-text content-type in standalone mode', async () => {
    server.use(
      http.get(
        'http://nontext-llms.local/llms.txt',
        () =>
          new HttpResponse('# Docs', {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
          }),
      ),
      http.get(
        'http://nontext-llms.local/docs/llms.txt',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
      http.get('http://nontext-llms.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://nontext-llms.local/sitemap.xml',
        () => new HttpResponse('', { status: 404 }),
      ),
    );

    const ctx = createContext('http://nontext-llms.local', { requestDelay: 0 });
    const result = await getPageUrls(ctx);
    // Falls through to baseUrl since llms.txt had wrong content-type
    expect(result.urls).toEqual(['http://nontext-llms.local']);
  });

  it('skips llms.txt that returns HTML in standalone mode', async () => {
    server.use(
      http.get(
        'http://html-llms.local/llms.txt',
        () =>
          new HttpResponse('<!DOCTYPE html><html><body>Not found</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        'http://html-llms.local/docs/llms.txt',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
      http.get('http://html-llms.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://html-llms.local/sitemap.xml', () => new HttpResponse('', { status: 404 })),
    );

    const ctx = createContext('http://html-llms.local', { requestDelay: 0 });
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://html-llms.local']);
  });

  it('skips empty llms.txt in standalone mode', async () => {
    server.use(
      http.get(
        'http://empty-llms.local/llms.txt',
        () =>
          new HttpResponse('   \n  ', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      ),
      http.get(
        'http://empty-llms.local/docs/llms.txt',
        () => new HttpResponse('Not found', { status: 404 }),
      ),
      http.get('http://empty-llms.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://empty-llms.local/sitemap.xml', () => new HttpResponse('', { status: 404 })),
    );

    const ctx = createContext('http://empty-llms.local', { requestDelay: 0 });
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://empty-llms.local']);
  });

  it('handles llms.txt fetch errors gracefully in standalone mode', async () => {
    server.use(
      http.get('http://err-llms.local/llms.txt', () => HttpResponse.error()),
      http.get('http://err-llms.local/docs/llms.txt', () => HttpResponse.error()),
      http.get('http://err-llms.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://err-llms.local/sitemap.xml', () => new HttpResponse('', { status: 404 })),
    );

    const ctx = createContext('http://err-llms.local', { requestDelay: 0 });
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://err-llms.local']);
  });

  // ── Existing sitemap tests ──

  it('processes non-gzipped sitemaps alongside gzipped ones from robots.txt', async () => {
    server.use(
      http.get(
        'http://gz-mixed.local/robots.txt',
        () =>
          new HttpResponse(
            'Sitemap: http://gz-mixed.local/sitemap.xml.gz\nSitemap: http://gz-mixed.local/sitemap.xml\n',
            { status: 200 },
          ),
      ),
      http.get(
        'http://gz-mixed.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://gz-mixed.local/page</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://gz-mixed.local');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual(['http://gz-mixed.local/page']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('sitemap.xml.gz');
  });
});

describe('discoverAndSamplePages', () => {
  function makeCtx(baseUrl: string, llmsTxtContent: string, opts?: Record<string, unknown>) {
    const ctx = createContext(baseUrl, { requestDelay: 0, ...opts });
    const discovered: DiscoveredFile[] = [
      { url: `${baseUrl}/llms.txt`, content: llmsTxtContent, status: 200, redirected: false },
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

  it('returns all URLs without sampling when under maxLinksToTest', async () => {
    const content = `# Docs\n> Summary\n## Links\n- [A](http://sample.local/a): A\n- [B](http://sample.local/b): B\n`;
    const ctx = makeCtx('http://sample.local', content, { maxLinksToTest: 10 });

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toEqual(['http://sample.local/a', 'http://sample.local/b']);
    expect(result.totalPages).toBe(2);
    expect(result.sampled).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('samples down to maxLinksToTest when over limit', async () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => `- [Page ${i}](http://sample-big.local/page${i}): Page ${i}`,
    ).join('\n');
    const content = `# Docs\n> Summary\n## Links\n${links}\n`;
    const ctx = makeCtx('http://sample-big.local', content, { maxLinksToTest: 3 });

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toHaveLength(3);
    expect(result.totalPages).toBe(10);
    expect(result.sampled).toBe(true);
    // All returned URLs should be from the original set
    for (const url of result.urls) {
      expect(url).toMatch(/^http:\/\/sample-big\.local\/page\d$/);
    }
  });

  it('passes through warnings from discovery', async () => {
    server.use(
      http.get(
        'http://sample-warn.local/robots.txt',
        () =>
          new HttpResponse('Sitemap: http://sample-warn.local/sitemap.xml.gz\n', { status: 200 }),
      ),
    );

    // No llms.txt content, so discovery falls through to sitemap (which is gzipped → warning → fallback)
    const ctx = createContext('http://sample-warn.local', { requestDelay: 0 });
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'llms-txt',
      status: 'fail',
      message: 'No llms.txt found',
      details: { discoveredFiles: [] },
    });

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toEqual(['http://sample-warn.local']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('gzipped sitemap');
  });
});
