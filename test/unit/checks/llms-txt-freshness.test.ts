import { describe, test, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { getCheck } from '../../../src/checks/registry.js';
import { createContext } from '../../../src/runner.js';
import type { DiscoveredFile } from '../../../src/types.js';

// Ensure the check is registered
import '../../../src/checks/observability/llms-txt-freshness.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

const check = getCheck('llms-txt-freshness');

/**
 * Build a minimal llms.txt content string from an array of URLs.
 */
function makeLlmsTxt(urls: string[]): string {
  return ['# Docs\n', ...urls.map((u) => `- [Page](${u})`)].join('\n');
}

/**
 * Build a minimal sitemap XML from an array of URLs.
 */
function makeSitemap(urls: string[]): string {
  const locs = urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n');
  return `<?xml version="1.0"?>\n<urlset>\n${locs}\n</urlset>`;
}

/**
 * Build a sitemap index XML pointing to child sitemaps.
 */
function makeSitemapIndex(sitemapUrls: string[]): string {
  const entries = sitemapUrls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join('\n');
  return `<?xml version="1.0"?>\n<sitemapindex>\n${entries}\n</sitemapindex>`;
}

/**
 * Create a test context with llms-txt-exists populated.
 */
function makeCtx(host: string, llmsTxtUrls: string[], basePath = '') {
  const baseUrl = `http://${host}${basePath}`;
  const ctx = createContext(baseUrl, { requestDelay: 0 });
  const content = makeLlmsTxt(llmsTxtUrls);
  const discovered: DiscoveredFile[] = [
    { url: `http://${host}/llms.txt`, content, status: 200, redirected: false },
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

describe('llms-txt-freshness', () => {
  test('passes when llms.txt fully covers sitemap', async () => {
    const host = 'fresh-pass.local';
    const pages = [
      `http://${host}/docs/getting-started`,
      `http://${host}/docs/api-reference`,
      `http://${host}/docs/guides/auth`,
    ];

    const ctx = makeCtx(host, pages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(pages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.coverageRate).toBe(100);
    expect(result.details?.unmatchedCount).toBe(0);
  });

  test('passes when llms.txt uses .md URLs matching sitemap HTML URLs', async () => {
    const host = 'fresh-md.local';
    const llmsUrls = [
      `http://${host}/docs/getting-started.md`,
      `http://${host}/docs/api-reference.md`,
    ];
    const sitemapUrls = [
      `http://${host}/docs/getting-started`,
      `http://${host}/docs/api-reference`,
    ];

    const ctx = makeCtx(host, llmsUrls, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapUrls), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.coverageRate).toBe(100);
  });

  test('passes with trailing slash differences', async () => {
    const host = 'fresh-slash.local';
    const llmsUrls = [`http://${host}/docs/guide`];
    const sitemapUrls = [`http://${host}/docs/guide/`];

    const ctx = makeCtx(host, llmsUrls, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapUrls), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.coverageRate).toBe(100);
  });

  test('warns when coverage is between 80% and 95%', async () => {
    const host = 'fresh-warn.local';
    // llms.txt has 9 of 10 pages (90% coverage)
    const allPages = Array.from({ length: 10 }, (_, i) => `http://${host}/docs/page-${i}`);
    const llmsPages = allPages.slice(0, 9);

    const ctx = makeCtx(host, llmsPages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(allPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
    expect(result.details?.coverageRate).toBe(90);
    expect(result.details?.missingCount).toBe(1);
  });

  test('fails when coverage is below 80%', async () => {
    const host = 'fresh-fail.local';
    // llms.txt has 5 of 10 pages (50% coverage)
    const allPages = Array.from({ length: 10 }, (_, i) => `http://${host}/docs/page-${i}`);
    const llmsPages = allPages.slice(0, 5);

    const ctx = makeCtx(host, llmsPages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(allPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.details?.coverageRate).toBe(50);
    expect(result.details?.missingCount).toBe(5);
  });

  test('reports unmatched llms.txt links not in sitemap', async () => {
    const host = 'fresh-unmatched.local';
    const sitemapPages = Array.from({ length: 10 }, (_, i) => `http://${host}/docs/page-${i}`);
    // llms.txt has all sitemap pages plus 3 extras not in sitemap
    const llmsPages = [
      ...sitemapPages,
      `http://${host}/docs/extra-page-a`,
      `http://${host}/docs/extra-page-b`,
      `http://${host}/docs/extra-page-c`,
    ];

    const ctx = makeCtx(host, llmsPages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    // Unmatched links are informational; coverage is 100% so status is pass
    expect(result.status).toBe('pass');
    expect(result.details?.unmatchedCount).toBe(3);
    expect(result.details?.coverageRate).toBe(100);
  });

  test('unmatched links do not affect overall status', async () => {
    const host = 'fresh-unmatched-pass.local';
    // Coverage is fine (100%) but many unmatched llms.txt links
    const sitemapPages = Array.from({ length: 5 }, (_, i) => `http://${host}/docs/page-${i}`);
    const llmsPages = [
      ...sitemapPages,
      `http://${host}/docs/unmatched-a`,
      `http://${host}/docs/unmatched-b`,
      `http://${host}/docs/unmatched-c`,
      `http://${host}/docs/unmatched-d`,
    ];

    const ctx = makeCtx(host, llmsPages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    // Status based on coverage only (pass), unmatched is informational
    expect(result.status).toBe('pass');
    expect(result.details?.unmatchedCount).toBe(4);
    expect(result.message).toContain('not in sitemap');
  });

  test('skips when no sitemap is available', async () => {
    const host = 'fresh-no-sitemap.local';
    const ctx = makeCtx(host, [`http://${host}/docs/page`], '/docs');

    server.use(
      http.get(`http://${host}/robots.txt`, () => new HttpResponse('', { status: 404 })),
      http.get(`http://${host}/sitemap.xml`, () => new HttpResponse('', { status: 404 })),
      http.get(`http://${host}/docs/sitemap.xml`, () => new HttpResponse('', { status: 404 })),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('No sitemap found');
  });

  test('skips when no page URLs in llms.txt', async () => {
    const host = 'fresh-no-pages.local';
    const ctx = createContext(`http://${host}/docs`, { requestDelay: 0 });
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'llms-txt',
      status: 'pass',
      message: 'Found',
      details: {
        discoveredFiles: [
          {
            url: `http://${host}/llms.txt`,
            content: '# Docs\n\nNo links here.',
            status: 200,
            redirected: false,
          },
        ],
      },
    });

    const result = await check.run(ctx);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('No page URLs found');
  });

  test('scopes sitemap URLs to baseUrl path prefix', async () => {
    const host = 'fresh-scope.local';
    const docPages = [`http://${host}/docs/guide`, `http://${host}/docs/api`];
    const allSitemapPages = [
      ...docPages,
      `http://${host}/marketing/page`,
      `http://${host}/about`,
      `http://${host}/pricing`,
    ];

    const ctx = makeCtx(host, docPages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(allSitemapPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    // Only 2 doc pages in scope, both covered
    expect(result.details?.sitemapDocPages).toBe(2);
    expect(result.details?.coverageRate).toBe(100);
  });

  test('excludes blog/changelog/pricing paths from sitemap comparison', async () => {
    const host = 'fresh-exclude.local';
    const docPages = [`http://${host}/guide`];
    const sitemapPages = [
      `http://${host}/guide`,
      `http://${host}/blog/post-1`,
      `http://${host}/changelog/v2`,
      `http://${host}/pricing`,
      `http://${host}/careers/engineer`,
    ];

    // baseUrl is root, so all paths are in scope
    const ctx = makeCtx(host, docPages, '');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    // Only /guide should be in the doc pages set (others excluded)
    expect(result.details?.sitemapDocPages).toBe(1);
    expect(result.details?.excludedNonDocPages).toBe(4);
    expect(result.status).toBe('pass');
  });

  test('handles index.md normalization', async () => {
    const host = 'fresh-index.local';
    const llmsUrls = [`http://${host}/docs/guide/index.md`];
    const sitemapUrls = [`http://${host}/docs/guide/`];

    const ctx = makeCtx(host, llmsUrls, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapUrls), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.coverageRate).toBe(100);
  });

  test('skips when sitemap has no URLs under docs path prefix', async () => {
    const host = 'fresh-no-scope.local';
    const ctx = makeCtx(host, [`http://${host}/docs/page`], '/docs');
    const sitemapPages = [`http://${host}/marketing/page1`, `http://${host}/marketing/page2`];

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
      http.get(`http://${host}/docs/sitemap.xml`, () => new HttpResponse('', { status: 404 })),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('none are under the docs path prefix');
  });

  test('does not count cross-origin llms.txt URLs as unmatched', async () => {
    const host = 'fresh-cross.local';
    const sitemapPages = [`http://${host}/docs/page`];
    // llms.txt links to a page on a different host — should not be flagged
    const llmsPages = [`http://${host}/docs/page`, `http://other-host.local/docs/external`];

    const ctx = makeCtx(host, llmsPages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.unmatchedCount).toBe(0);
  });

  test('falls back to docs-specific sitemap when main sitemap has no docs URLs', async () => {
    const host = 'fresh-docs-sitemap.local';
    const docPages = [`http://${host}/docs/guide`, `http://${host}/docs/api`];
    const marketingPages = [`http://${host}/about`, `http://${host}/pricing`];

    const ctx = makeCtx(host, docPages, '/docs');

    server.use(
      // Main sitemap has only marketing pages
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(marketingPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
      // Docs-specific sitemap has the doc pages
      http.get(
        `http://${host}/docs/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(docPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.sitemapDocPages).toBe(2);
    expect(result.details?.sitemapSource).toBe('/docs/sitemap.xml');
    expect(result.details?.coverageRate).toBe(100);
  });

  test('follows docs-specific sitemap index one level deep', async () => {
    const host = 'fresh-docs-index.local';
    const docPages = [
      `http://${host}/docs/guide`,
      `http://${host}/docs/api`,
      `http://${host}/docs/reference`,
    ];

    const ctx = makeCtx(host, docPages, '/docs');

    server.use(
      // No main sitemap
      http.get(`http://${host}/robots.txt`, () => new HttpResponse('', { status: 404 })),
      http.get(`http://${host}/sitemap.xml`, () => new HttpResponse('', { status: 404 })),
      // Docs sitemap is an index
      http.get(
        `http://${host}/docs/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemapIndex([`http://${host}/docs/sitemap-pages.xml`]), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
      http.get(
        `http://${host}/docs/sitemap-pages.xml`,
        () =>
          new HttpResponse(makeSitemap(docPages), {
            status: 200,
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.sitemapDocPages).toBe(3);
    expect(result.details?.sitemapSource).toBe('/docs/sitemap.xml');
  });

  test('filters sitemap to matching locale when locale pattern detected', async () => {
    const host = 'locale-filter.local';
    // llms.txt only covers English pages
    const llmsPages = [
      `http://${host}/docs/en/getting-started`,
      `http://${host}/docs/en/api-reference`,
      `http://${host}/docs/en/guides`,
    ];

    // Sitemap has 3 English + 3 German + 3 French = 9 pages
    const sitemapPages = [
      ...llmsPages,
      `http://${host}/docs/de/getting-started`,
      `http://${host}/docs/de/api-reference`,
      `http://${host}/docs/de/guides`,
      `http://${host}/docs/fr/getting-started`,
      `http://${host}/docs/fr/api-reference`,
      `http://${host}/docs/fr/guides`,
    ];

    const ctx = makeCtx(host, llmsPages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapPages), {
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.localeFiltered).toBe(true);
    expect(result.details?.detectedLocale).toBe('en');
    // After locale filtering, only the 3 English pages remain
    expect(result.details?.sitemapDocPages).toBe(3);
  });

  test('uses effectiveOrigin for sitemap discovery and scoping', async () => {
    const oldHost = 'old-host.local';
    const newHost = 'new-host.local';
    const pages = [
      `http://${newHost}/docs/getting-started`,
      `http://${newHost}/docs/api-reference`,
    ];

    const ctx = makeCtx(oldHost, pages, '/docs');
    // Simulate llms-txt-exists having detected a cross-host redirect
    ctx.effectiveOrigin = `http://${newHost}`;

    server.use(
      // robots.txt at old host fails
      http.get(`http://${oldHost}/robots.txt`, () => new HttpResponse(null, { status: 404 })),
      // robots.txt at new host works
      http.get(
        `http://${newHost}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${newHost}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${newHost}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(pages), {
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    expect(result.details?.sitemapDocPages).toBe(2);
  });

  test('excludes paths relative to base URL prefix', async () => {
    const host = 'basepath-exclude.local';
    const pages = [`http://${host}/docs/getting-started`, `http://${host}/docs/api-reference`];

    // Sitemap includes /docs/changelog pages that should be excluded
    const sitemapPages = [
      ...pages,
      `http://${host}/docs/changelog/2024-01-01`,
      `http://${host}/docs/changelog/2024-02-01`,
      `http://${host}/docs/blog/post-1`,
    ];

    const ctx = makeCtx(host, pages, '/docs');

    server.use(
      http.get(
        `http://${host}/robots.txt`,
        () => new HttpResponse(`Sitemap: http://${host}/sitemap.xml`, { status: 200 }),
      ),
      http.get(
        `http://${host}/sitemap.xml`,
        () =>
          new HttpResponse(makeSitemap(sitemapPages), {
            headers: { 'content-type': 'application/xml' },
          }),
      ),
    );

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    // Only 2 doc pages remain after excluding /docs/changelog and /docs/blog
    expect(result.details?.sitemapDocPages).toBe(2);
    expect(result.details?.excludedNonDocPages).toBe(3);
  });
});
