import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  getPageUrls,
  discoverAndSamplePages,
  parseSitemapUrls,
  parseSitemapDirectives,
  filterByPathPrefix,
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

describe('filterByPathPrefix', () => {
  it('filters URLs to those under the path prefix', () => {
    const urls = [
      'https://example.com/docs/intro',
      'https://example.com/docs/guide',
      'https://example.com/blog/post1',
      'https://example.com/careers',
    ];
    const result = filterByPathPrefix(urls, 'https://example.com/docs');
    expect(result).toEqual(['https://example.com/docs/intro', 'https://example.com/docs/guide']);
  });

  it('includes the exact baseUrl path itself', () => {
    const urls = ['https://example.com/docs', 'https://example.com/docs/page'];
    const result = filterByPathPrefix(urls, 'https://example.com/docs');
    expect(result).toEqual(['https://example.com/docs', 'https://example.com/docs/page']);
  });

  it('passes all URLs through when baseUrl is at the root', () => {
    const urls = [
      'https://example.com/docs/intro',
      'https://example.com/blog/post1',
      'https://example.com/careers',
    ];
    const result = filterByPathPrefix(urls, 'https://example.com');
    expect(result).toEqual(urls);
  });

  it('passes all URLs through when baseUrl has a trailing slash root', () => {
    const urls = ['https://example.com/a', 'https://example.com/b'];
    const result = filterByPathPrefix(urls, 'https://example.com/');
    expect(result).toEqual(urls);
  });

  it('does not match partial path segments', () => {
    // /docs-extra should NOT match /docs prefix
    const urls = ['https://example.com/docs/page', 'https://example.com/docs-extra/page'];
    const result = filterByPathPrefix(urls, 'https://example.com/docs');
    expect(result).toEqual(['https://example.com/docs/page']);
  });

  it('handles deeper path prefixes', () => {
    const urls = [
      'https://example.com/api/v2/docs/page',
      'https://example.com/api/v2/other',
      'https://example.com/api/v1/docs/page',
    ];
    const result = filterByPathPrefix(urls, 'https://example.com/api/v2/docs');
    expect(result).toEqual(['https://example.com/api/v2/docs/page']);
  });

  it('keeps malformed URLs rather than dropping them', () => {
    const urls = ['not-a-url', 'https://example.com/docs/page'];
    const result = filterByPathPrefix(urls, 'https://example.com/docs');
    expect(result).toEqual(['not-a-url', 'https://example.com/docs/page']);
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
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
    } else {
      // Mark llms-txt-exists as having run (but failed) so getPageUrls
      // skips the direct llms.txt fetch and falls through to sitemap.
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

  it('applies path-prefix filter before the sitemap URL cap (#31)', async () => {
    // Simulate Django-like sitemap index: Greek sitemap comes first alphabetically,
    // filling the cap before the English sitemap is reached. Without the fix,
    // path-prefix filtering after the cap would discard all Greek URLs and return 0 matches.
    const greekLocs = Array.from(
      { length: MAX_SITEMAP_URLS },
      (_, i) => `  <url><loc>http://cap-prefix.local/el/page/${i}</loc></url>`,
    ).join('\n');
    const englishLocs = Array.from(
      { length: 50 },
      (_, i) => `  <url><loc>http://cap-prefix.local/en/6.0/page/${i}</loc></url>`,
    ).join('\n');

    server.use(
      http.get('http://cap-prefix.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://cap-prefix.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>http://cap-prefix.local/sitemap-el.xml</loc></sitemap>
  <sitemap><loc>http://cap-prefix.local/sitemap-en.xml</loc></sitemap>
</sitemapindex>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
      http.get(
        'http://cap-prefix.local/sitemap-el.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${greekLocs}\n</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
      http.get(
        'http://cap-prefix.local/sitemap-en.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${englishLocs}\n</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    // User wants to test /en/6.0/ docs specifically
    const ctx = makeCtx('http://cap-prefix.local/en/6.0');
    const result = await getPageUrls(ctx);

    // With the fix: path filter is applied before the cap, so Greek URLs
    // don't consume cap slots. All 50 English URLs should be found.
    expect(result.urls.length).toBe(50);
    expect(result.urls.every((u) => u.includes('/en/6.0/'))).toBe(true);
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

  // ── Progressive disclosure: walking aggregate .txt files ──

  it('walks aggregate .txt files linked from llms.txt (Cloudflare pattern)', async () => {
    // Root llms.txt links to per-product llms.txt files
    const rootContent = `# Docs\n- [Workers](http://walk-test.local/workers/llms.txt)\n- [Cache](http://walk-test.local/cache/llms.txt)\n`;
    const workersContent = `# Workers\n- [Guide](http://walk-test.local/workers/guide/index.md): Get started\n- [API](http://walk-test.local/workers/api/index.md): API ref\n`;
    const cacheContent = `# Cache\n- [Overview](http://walk-test.local/cache/overview/index.md): Overview\n`;

    server.use(
      http.get(
        'http://walk-test.local/workers/llms.txt',
        () =>
          new HttpResponse(workersContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
      http.get(
        'http://walk-test.local/cache/llms.txt',
        () =>
          new HttpResponse(cacheContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );

    const ctx = makeCtx('http://walk-test.local', rootContent);
    const result = await getPageUrls(ctx);
    expect(result.urls).toContain('http://walk-test.local/workers/guide/index.md');
    expect(result.urls).toContain('http://walk-test.local/workers/api/index.md');
    expect(result.urls).toContain('http://walk-test.local/cache/overview/index.md');
    expect(result.urls).toHaveLength(3);
  });

  it('walks aggregate .txt files with relative URLs (Supabase pattern)', async () => {
    // Root llms.txt links to aggregate content files
    const rootContent = `# Docs\n- [Guides](http://walk-rel.local/llms/guides.txt)\n`;
    const guidesContent = `# Guides\n\nLearn about [auth](/docs/guides/auth) and [storage](/docs/guides/storage).\n`;

    server.use(
      http.get(
        'http://walk-rel.local/llms/guides.txt',
        () =>
          new HttpResponse(guidesContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );

    const ctx = makeCtx('http://walk-rel.local', rootContent);
    const result = await getPageUrls(ctx);
    expect(result.urls).toContain('http://walk-rel.local/docs/guides/auth');
    expect(result.urls).toContain('http://walk-rel.local/docs/guides/storage');
  });

  it('resolves relative URLs in root llms.txt against origin', async () => {
    const content = `# Docs\n- [Guide](/docs/guide): A guide\n- [Ref](/docs/ref): A ref\n`;
    const ctx = makeCtx('http://rel-root.local', content);
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://rel-root.local/docs/guide',
      'http://rel-root.local/docs/ref',
    ]);
  });

  it('does not walk .txt files from a different origin', async () => {
    const content = `# Docs\n- [External](http://other-site.com/llms.txt)\n- [Local](http://no-walk.local/docs/page): Page\n`;
    const ctx = makeCtx('http://no-walk.local', content);
    const result = await getPageUrls(ctx);
    // Should only have the local page URL, not try to fetch the external .txt
    expect(result.urls).toEqual(['http://no-walk.local/docs/page']);
  });

  it('falls through to baseUrl when all aggregate files fail', async () => {
    const rootContent = `# Docs\n- [Bad](http://walk-err.local/bad.txt)\n- [Html](http://walk-err.local/html.txt)\n`;

    server.use(
      http.get('http://walk-err.local/bad.txt', () => new HttpResponse('', { status: 404 })),
      http.get(
        'http://walk-err.local/html.txt',
        () =>
          new HttpResponse('<!DOCTYPE html><html></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get('http://walk-err.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://walk-err.local/sitemap.xml', () => new HttpResponse('', { status: 404 })),
    );

    const ctx = makeCtx('http://walk-err.local', rootContent);
    const result = await getPageUrls(ctx);
    // All aggregate files failed → no page URLs → falls through to baseUrl
    expect(result.urls).toEqual(['http://walk-err.local']);
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

  // ── Path-prefix scoping ──

  it('scopes llms.txt URLs to the baseUrl path prefix', async () => {
    const content = `# Docs\n> Summary\n## Links\n- [Intro](http://scope-test.local/docs/intro): Intro\n- [Guide](http://scope-test.local/docs/guide): Guide\n- [Blog](http://scope-test.local/blog/post1): A blog post\n- [Careers](http://scope-test.local/careers): Careers page\n`;
    const ctx = makeCtx('http://scope-test.local/docs', content);

    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://scope-test.local/docs/intro',
      'http://scope-test.local/docs/guide',
    ]);
  });

  it('does not filter when baseUrl is at the root', async () => {
    const content = `# Docs\n- [A](http://root-scope.local/docs/a): A\n- [B](http://root-scope.local/blog/b): B\n`;
    const ctx = makeCtx('http://root-scope.local', content);

    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://root-scope.local/docs/a',
      'http://root-scope.local/blog/b',
    ]);
  });

  it('scopes sitemap URLs to the baseUrl path prefix', async () => {
    server.use(
      http.get(
        'http://sitemap-scope.local/robots.txt',
        () => new HttpResponse('', { status: 404 }),
      ),
      http.get(
        'http://sitemap-scope.local/sitemap.xml',
        () =>
          new HttpResponse(
            `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://sitemap-scope.local/docs/intro</loc></url>
  <url><loc>http://sitemap-scope.local/docs/guide</loc></url>
  <url><loc>http://sitemap-scope.local/blog/post1</loc></url>
  <url><loc>http://sitemap-scope.local/careers</loc></url>
</urlset>`,
            { status: 200, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );

    const ctx = makeCtx('http://sitemap-scope.local/docs');
    const result = await getPageUrls(ctx);
    expect(result.urls).toEqual([
      'http://sitemap-scope.local/docs/intro',
      'http://sitemap-scope.local/docs/guide',
    ]);
  });

  it('skips path filtering when effectiveOrigin differs from origin (cross-host redirect)', async () => {
    // Simulate: user provides example.com/docs, which redirects to docs.example.com
    // llms.txt on docs.example.com has links at root paths, not under /docs
    const content = `# Docs\n- [Intro](http://xhost.local/intro): Intro\n- [Guide](http://xhost.local/guide): Guide\n`;
    const ctx = makeCtx('http://original.local/docs', content);
    // Simulate cross-host redirect detection
    ctx.effectiveOrigin = 'http://xhost.local';

    const result = await getPageUrls(ctx);
    // Without the cross-host bypass, these would be filtered out (not under /docs)
    expect(result.urls).toContain('http://xhost.local/intro');
    expect(result.urls).toContain('http://xhost.local/guide');
    expect(result.urls).toHaveLength(2);
  });

  it('falls back to baseUrl when path scoping filters out all discovered URLs', async () => {
    // llms.txt has only non-docs URLs
    const content = `# Site\n- [Blog](http://filter-all.local/blog/post): Post\n- [About](http://filter-all.local/about): About\n`;

    server.use(
      http.get('http://filter-all.local/robots.txt', () => new HttpResponse('', { status: 404 })),
      http.get('http://filter-all.local/sitemap.xml', () => new HttpResponse('', { status: 404 })),
    );

    const ctx = makeCtx('http://filter-all.local/docs', content);
    const result = await getPageUrls(ctx);
    // Path filtering removed all llms.txt URLs, no sitemap available → fallback
    expect(result.urls).toEqual(['http://filter-all.local/docs']);
  });

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
      category: 'content-discoverability',
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

  it('deterministic strategy produces stable evenly-spaced results', async () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => `- [Page ${i}](http://det.local/page-${String(i).padStart(2, '0')}): Page ${i}`,
    ).join('\n');
    const content = `# Docs\n> Summary\n## Links\n${links}\n`;
    const ctx = makeCtx('http://det.local', content, {
      maxLinksToTest: 3,
      samplingStrategy: 'deterministic',
    });

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toHaveLength(3);
    expect(result.totalPages).toBe(10);
    expect(result.sampled).toBe(true);

    // Run again with a fresh context — should produce the same URLs
    const ctx2 = makeCtx('http://det.local', content, {
      maxLinksToTest: 3,
      samplingStrategy: 'deterministic',
    });
    const result2 = await discoverAndSamplePages(ctx2);
    expect(result2.urls).toEqual(result.urls);

    // URLs should be evenly spaced from the sorted list
    // Sorted: page-00 through page-09, stride = 10/3 ≈ 3.33
    // Indices: floor(0*3.33)=0, floor(1*3.33)=3, floor(2*3.33)=6
    expect(result.urls).toEqual([
      'http://det.local/page-00',
      'http://det.local/page-03',
      'http://det.local/page-06',
    ]);
  });

  it('none strategy returns only the baseUrl without discovery', async () => {
    const content = `# Docs\n> Summary\n## Links\n- [A](http://none-test.local/a): A\n- [B](http://none-test.local/b): B\n`;
    const ctx = makeCtx('http://none-test.local', content, {
      samplingStrategy: 'none',
    });

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toEqual(['http://none-test.local']);
    expect(result.totalPages).toBe(1);
    expect(result.sampled).toBe(false);
  });

  it('curated strategy returns configured URLs without discovery', async () => {
    const ctx = createContext('http://curated.local', {
      requestDelay: 0,
      samplingStrategy: 'curated',
    });
    ctx._curatedPages = ['http://curated.local/page-a', 'http://curated.local/page-b'];

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toEqual(['http://curated.local/page-a', 'http://curated.local/page-b']);
    expect(result.totalPages).toBe(2);
    expect(result.sampled).toBe(false);
    expect(result.urlTags).toBeUndefined();
  });

  it('curated strategy with tagged objects populates urlTags', async () => {
    const ctx = createContext('http://curated-tags.local', {
      requestDelay: 0,
      samplingStrategy: 'curated',
    });
    ctx._curatedPages = [
      'http://curated-tags.local/page-a',
      { url: 'http://curated-tags.local/page-b', tag: 'api' },
      { url: 'http://curated-tags.local/page-c', tag: 'guides' },
    ];

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toHaveLength(3);
    expect(result.urlTags).toEqual({
      'http://curated-tags.local/page-b': 'api',
      'http://curated-tags.local/page-c': 'guides',
    });
  });

  it('curated strategy with empty pages falls back to baseUrl', async () => {
    const ctx = createContext('http://curated-empty.local', {
      requestDelay: 0,
      samplingStrategy: 'curated',
    });
    ctx._curatedPages = [];

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toEqual(['http://curated-empty.local']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('no pages defined');
  });

  it('curated strategy does not apply maxLinksToTest', async () => {
    const urls = Array.from({ length: 100 }, (_, i) => `http://curated-many.local/page-${i}`);
    const ctx = createContext('http://curated-many.local', {
      requestDelay: 0,
      samplingStrategy: 'curated',
      maxLinksToTest: 5,
    });
    ctx._curatedPages = urls;

    const result = await discoverAndSamplePages(ctx);
    expect(result.urls).toHaveLength(100);
    expect(result.sampled).toBe(false);
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
      category: 'content-discoverability',
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
