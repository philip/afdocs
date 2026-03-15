/**
 * Cross-check integration tests.
 *
 * These tests run real checks in sequence through the runner and verify that
 * data flows correctly between them via pageCache and previousResults.
 * Unlike unit tests (which manually construct context), these exercise
 * the actual pipeline: discovery → upstream checks → downstream consumers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { runChecks } from '../../src/runner.js';
import '../../src/checks/index.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

/**
 * Helper: set up a docs site with llms.txt, page links, optional .md URLs,
 * and optional content-negotiation support.
 */
function setupSite(
  host: string,
  opts: {
    llmsTxt?: string;
    pages: Array<{
      path: string;
      html?: string;
      md?: string;
      contentNeg?: string;
    }>;
    softNotFound?: boolean;
    cacheControl?: string;
  },
) {
  const handlers = [];

  // llms.txt
  if (opts.llmsTxt) {
    handlers.push(http.get(`http://${host}/llms.txt`, () => HttpResponse.text(opts.llmsTxt!)));
  } else {
    handlers.push(
      http.get(`http://${host}/llms.txt`, () => new HttpResponse(null, { status: 404 })),
    );
  }
  handlers.push(
    http.get(`http://${host}/docs/llms.txt`, () => new HttpResponse(null, { status: 404 })),
  );

  const defaultCacheHeaders = opts.cacheControl ? { 'Cache-Control': opts.cacheControl } : {};

  for (const page of opts.pages) {
    // HTML version
    handlers.push(
      http.get(`http://${host}${page.path}`, ({ request }) => {
        const accept = request.headers.get('accept') ?? '';

        // Content negotiation: if requesting markdown and the page supports it
        if (accept.includes('text/markdown') && page.contentNeg) {
          return new HttpResponse(page.contentNeg, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown', ...defaultCacheHeaders },
          });
        }

        return new HttpResponse(
          page.html ?? `<html><body><h1>Page</h1><p>Content for ${page.path}</p></body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html', ...defaultCacheHeaders } },
        );
      }),
    );

    // .md URL
    if (page.md) {
      handlers.push(
        http.get(
          `http://${host}${page.path}.md`,
          () =>
            new HttpResponse(page.md!, {
              status: 200,
              headers: { 'Content-Type': 'text/markdown', ...defaultCacheHeaders },
            }),
        ),
      );
    } else {
      handlers.push(
        http.get(`http://${host}${page.path}.md`, () => new HttpResponse(null, { status: 404 })),
      );
    }

    // Bad URL for http-status-codes
    const badPath = `${page.path}-afdocs-nonexistent-8f3a`;
    if (opts.softNotFound) {
      handlers.push(
        http.get(
          `http://${host}${badPath}`,
          () =>
            new HttpResponse('<html><body>Home</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            }),
        ),
      );
    } else {
      handlers.push(
        http.get(`http://${host}${badPath}`, () => new HttpResponse('Not Found', { status: 404 })),
      );
    }
  }

  server.use(...handlers);
}

describe('check pipeline: markdown availability → downstream consumers', () => {
  it('markdown-url-support populates pageCache for page-size-markdown', async () => {
    const mdContent =
      '# Getting Started\n\nThis is a guide with some content.\n\n```js\nconsole.log("hello");\n```\n';
    setupSite('pipe-md.local', {
      llmsTxt:
        '# Docs\n## Links\n- [Getting Started](http://pipe-md.local/docs/getting-started): Guide\n',
      pages: [{ path: '/docs/getting-started', md: mdContent }],
    });

    const report = await runChecks('http://pipe-md.local', {
      checkIds: [
        'llms-txt-exists',
        'markdown-url-support',
        'page-size-markdown',
        'markdown-code-fence-validity',
      ],
      requestDelay: 0,
    });

    const mdUrlResult = report.results.find((r) => r.id === 'markdown-url-support')!;
    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;
    const fenceResult = report.results.find((r) => r.id === 'markdown-code-fence-validity')!;

    // Upstream should pass
    expect(mdUrlResult.status).toBe('pass');

    // Downstream checks should consume the cached content, not skip
    expect(sizeResult.status).not.toBe('skip');
    expect(sizeResult.details?.totalPages).toBe(1);
    const sizePageResults = sizeResult.details?.pageResults as Array<{
      source: string;
      characters: number;
    }>;
    expect(sizePageResults[0].source).toBe('md-url');
    expect(sizePageResults[0].characters).toBe(mdContent.length);

    // Fence validity should also see the cached content (plus llms.txt content)
    expect(fenceResult.status).toBe('pass');
    expect(fenceResult.details?.totalFences).toBe(1);
    // pagesAnalyzed includes the llms.txt file too
    expect(fenceResult.details?.pagesAnalyzed).toBe(2);
  });

  it('content-negotiation populates pageCache when md-url is unavailable', async () => {
    const cnContent = '# API Reference\n\nEndpoints and methods.\n';
    setupSite('pipe-cn.local', {
      llmsTxt: '# Docs\n## Links\n- [API](http://pipe-cn.local/docs/api): Reference\n',
      pages: [{ path: '/docs/api', contentNeg: cnContent }],
    });

    const report = await runChecks('http://pipe-cn.local', {
      checkIds: [
        'llms-txt-exists',
        'markdown-url-support',
        'content-negotiation',
        'page-size-markdown',
      ],
      requestDelay: 0,
    });

    const mdUrlResult = report.results.find((r) => r.id === 'markdown-url-support')!;
    const cnResult = report.results.find((r) => r.id === 'content-negotiation')!;
    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;

    // .md URLs fail, but content negotiation works
    expect(mdUrlResult.status).toBe('fail');
    expect(cnResult.status).not.toBe('skip');

    // page-size-markdown should still have content from content-negotiation
    expect(sizeResult.status).not.toBe('skip');
    expect(sizeResult.details?.totalPages).toBe(1);
    const sizePageResults = sizeResult.details?.pageResults as Array<{ source: string }>;
    expect(sizePageResults[0].source).toBe('content-negotiation');
  });

  it('content-negotiation does not overwrite pageCache entries from markdown-url-support', async () => {
    const mdContent = '# Via .md URL\n\nMarkdown from .md URL.\n';
    const cnContent = '# Via Content Negotiation\n\nMarkdown from CN.\n';
    setupSite('pipe-nooverwrite.local', {
      llmsTxt: '# Docs\n## Links\n- [Page](http://pipe-nooverwrite.local/docs/page): A page\n',
      pages: [{ path: '/docs/page', md: mdContent, contentNeg: cnContent }],
    });

    const report = await runChecks('http://pipe-nooverwrite.local', {
      checkIds: [
        'llms-txt-exists',
        'markdown-url-support',
        'content-negotiation',
        'page-size-markdown',
      ],
      requestDelay: 0,
    });

    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;
    expect(sizeResult.details?.totalPages).toBe(1);

    // Should be from md-url (first check to populate cache), not content-negotiation
    const sizePageResults = sizeResult.details?.pageResults as Array<{
      source: string;
      characters: number;
    }>;
    expect(sizePageResults[0].source).toBe('md-url');
    expect(sizePageResults[0].characters).toBe(mdContent.length);
  });
});

describe('check pipeline: shared sampling across checks', () => {
  it('all checks test the same sampled pages', async () => {
    // Create a site with enough pages to trigger sampling (> maxLinksToTest)
    const pages = [];
    const links = [];
    for (let i = 0; i < 60; i++) {
      const path = `/docs/page-${i}`;
      pages.push({ path, md: `# Page ${i}\n\nContent for page ${i}.\n` });
      links.push(`- [Page ${i}](http://pipe-sample.local${path}): Page ${i}`);
    }
    setupSite('pipe-sample.local', {
      llmsTxt: `# Docs\n## Links\n${links.join('\n')}\n`,
      pages,
    });

    const report = await runChecks('http://pipe-sample.local', {
      checkIds: [
        'llms-txt-exists',
        'markdown-url-support',
        'content-negotiation',
        'page-size-html',
        'http-status-codes',
      ],
      requestDelay: 0,
      maxLinksToTest: 10,
    });

    const mdUrlResult = report.results.find((r) => r.id === 'markdown-url-support')!;
    const cnResult = report.results.find((r) => r.id === 'content-negotiation')!;
    const htmlResult = report.results.find((r) => r.id === 'page-size-html')!;
    const statusResult = report.results.find((r) => r.id === 'http-status-codes')!;

    // All checks that use discoverAndSamplePages should report the same total
    expect(mdUrlResult.details?.totalPages).toBe(60);
    expect(cnResult.details?.totalPages).toBe(60);
    expect(htmlResult.details?.totalPages).toBe(60);
    expect(statusResult.details?.totalPages).toBe(60);

    // All should have tested the same sampled subset
    const mdUrlPages = (mdUrlResult.details?.pageResults as Array<{ url: string }>)
      .map((p) => p.url)
      .sort();
    const cnPages = (cnResult.details?.pageResults as Array<{ url: string }>)
      .map((p) => p.url)
      .sort();
    const htmlPages = (htmlResult.details?.pageResults as Array<{ url: string }>)
      .map((p) => p.url)
      .sort();

    expect(mdUrlPages).toEqual(cnPages);
    expect(mdUrlPages).toEqual(htmlPages);

    // http-status-codes tests derived URLs, but should have the same count
    expect(statusResult.details?.testedPages).toBe(10);
  });
});

describe('check pipeline: llms-txt content flows to downstream checks', () => {
  it('llms.txt content is included in fence validity analysis', async () => {
    const llmsContent =
      '# Docs\n\n```python\nprint("hello")\n```\n\n## Links\n- [Page](http://pipe-llms.local/docs/page): A page\n';
    const pageMd = '# Page\n\nNo fences here.\n';
    setupSite('pipe-llms.local', {
      llmsTxt: llmsContent,
      pages: [{ path: '/docs/page', md: pageMd }],
    });

    const report = await runChecks('http://pipe-llms.local', {
      checkIds: ['llms-txt-exists', 'markdown-url-support', 'markdown-code-fence-validity'],
      requestDelay: 0,
    });

    const fenceResult = report.results.find((r) => r.id === 'markdown-code-fence-validity')!;
    expect(fenceResult.status).toBe('pass');
    // Should include both the llms.txt content (1 fence) and the page (0 fences)
    expect(fenceResult.details?.pagesAnalyzed).toBe(2);
    expect(fenceResult.details?.totalFences).toBe(1);
  });

  it('llms.txt content is excluded from page-size-markdown (not a doc page)', async () => {
    const llmsContent =
      '# Docs\n\n## Links\n- [Page](http://pipe-llms-size.local/docs/page): A page\n';
    const pageMd = '# Page\n\nSome content.\n';
    setupSite('pipe-llms-size.local', {
      llmsTxt: llmsContent,
      pages: [{ path: '/docs/page', md: pageMd }],
    });

    const report = await runChecks('http://pipe-llms-size.local', {
      checkIds: ['llms-txt-exists', 'markdown-url-support', 'page-size-markdown'],
      requestDelay: 0,
    });

    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;
    // llms.txt pages are filtered out from size checking
    expect(sizeResult.details?.totalPages).toBe(1);
    const sizePageResults = sizeResult.details?.pageResults as Array<{ source: string }>;
    expect(sizePageResults.every((p) => p.source !== 'llms-txt')).toBe(true);
  });
});

describe('check pipeline: dependency skipping vs standalone mode', () => {
  it('downstream checks skip when upstream ran and failed', async () => {
    // Site with no .md URLs and no content negotiation
    setupSite('pipe-nmd.local', {
      llmsTxt: '# Docs\n## Links\n- [Page](http://pipe-nmd.local/docs/page): A page\n',
      pages: [{ path: '/docs/page' }],
    });

    const report = await runChecks('http://pipe-nmd.local', {
      checkIds: [
        'llms-txt-exists',
        'markdown-url-support',
        'content-negotiation',
        'page-size-markdown',
        'markdown-code-fence-validity',
      ],
      requestDelay: 0,
    });

    const mdUrlResult = report.results.find((r) => r.id === 'markdown-url-support')!;
    const cnResult = report.results.find((r) => r.id === 'content-negotiation')!;
    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;
    const fenceResult = report.results.find((r) => r.id === 'markdown-code-fence-validity')!;

    // Both upstream checks fail (no markdown available)
    expect(mdUrlResult.status).toBe('fail');
    expect(cnResult.status).toBe('fail');

    // Downstream checks should be skipped by the runner (deps ran but failed)
    expect(sizeResult.status).toBe('skip');
    expect(sizeResult.message).toContain('dependency');
    expect(fenceResult.status).toBe('skip');
    expect(fenceResult.message).toContain('dependency');
  });

  it('downstream checks run standalone when upstream is not in the check list', async () => {
    const pageMd = '# Page\n\n```js\nconsole.log("hi");\n```\n';
    setupSite('pipe-standalone.local', {
      llmsTxt: '# Docs\n## Links\n- [Page](http://pipe-standalone.local/docs/page): A page\n',
      pages: [{ path: '/docs/page', md: pageMd }],
    });

    const report = await runChecks('http://pipe-standalone.local', {
      // Only downstream checks; no markdown-url-support or content-negotiation
      checkIds: ['page-size-markdown', 'markdown-code-fence-validity'],
      requestDelay: 0,
    });

    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;
    const fenceResult = report.results.find((r) => r.id === 'markdown-code-fence-validity')!;

    // Should NOT be skipped — they run in standalone mode
    expect(sizeResult.status).not.toBe('skip');
    expect(sizeResult.message).not.toContain('dependency');
    expect(fenceResult.status).not.toBe('skip');
    expect(fenceResult.message).not.toContain('dependency');
  });
});

describe('check pipeline: llms-txt-exists → dependent checks data flow', () => {
  it('llms-txt-valid and llms-txt-size receive discoveredFiles from llms-txt-exists', async () => {
    const llmsContent =
      '# Test Docs\n\n> A test documentation site.\n\n## Links\n\n- [Guide](http://pipe-chain.local/docs/guide): A guide\n';
    setupSite('pipe-chain.local', {
      llmsTxt: llmsContent,
      pages: [{ path: '/docs/guide' }],
    });

    const report = await runChecks('http://pipe-chain.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid', 'llms-txt-size', 'llms-txt-links-resolve'],
      requestDelay: 0,
    });

    const existsResult = report.results.find((r) => r.id === 'llms-txt-exists')!;
    const validResult = report.results.find((r) => r.id === 'llms-txt-valid')!;
    const sizeResult = report.results.find((r) => r.id === 'llms-txt-size')!;
    const resolveResult = report.results.find((r) => r.id === 'llms-txt-links-resolve')!;

    // Upstream discovers the file
    expect(existsResult.status).toBe('pass');
    const discovered = existsResult.details?.discoveredFiles as Array<{
      url: string;
      content: string;
    }>;
    expect(discovered.length).toBeGreaterThanOrEqual(1);
    expect(discovered[0].content).toBe(llmsContent);

    // Downstream checks should all run (not skip)
    expect(validResult.status).not.toBe('skip');
    expect(sizeResult.status).not.toBe('skip');
    expect(resolveResult.status).not.toBe('skip');

    // Size check should measure the actual content length
    const sizes = sizeResult.details?.sizes as Array<{ characters: number }>;
    expect(sizes[0].characters).toBe(llmsContent.length);
  });

  it('llms-txt dependent checks all skip when llms.txt is not found', async () => {
    setupSite('pipe-nollms.local', {
      pages: [{ path: '/docs/page' }],
    });

    const report = await runChecks('http://pipe-nollms.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid', 'llms-txt-size', 'llms-txt-links-resolve'],
      requestDelay: 0,
    });

    expect(report.results.find((r) => r.id === 'llms-txt-exists')!.status).toBe('fail');
    expect(report.results.find((r) => r.id === 'llms-txt-valid')!.status).toBe('skip');
    expect(report.results.find((r) => r.id === 'llms-txt-size')!.status).toBe('skip');
    expect(report.results.find((r) => r.id === 'llms-txt-links-resolve')!.status).toBe('skip');
  });
});

describe('check pipeline: cache-header-hygiene llms.txt interaction', () => {
  it('includes llms.txt URLs when llms-txt-exists ran first', async () => {
    setupSite('pipe-chh-llms.local', {
      llmsTxt: '# Docs\n## Links\n- [Page](http://pipe-chh-llms.local/docs/page): A page\n',
      pages: [{ path: '/docs/page' }],
      cacheControl: 'no-cache',
    });

    const report = await runChecks('http://pipe-chh-llms.local', {
      checkIds: ['llms-txt-exists', 'cache-header-hygiene'],
      requestDelay: 0,
    });

    const cacheResult = report.results.find((r) => r.id === 'cache-header-hygiene')!;
    const endpoints = (cacheResult.details?.endpointResults as Array<{ url: string }>).map(
      (e) => e.url,
    );

    // Should include the llms.txt URL (from discoveredFiles) and the page URL
    expect(endpoints.some((u) => u.includes('llms.txt'))).toBe(true);
    expect(endpoints.some((u) => u.includes('/docs/page'))).toBe(true);
    expect(cacheResult.details?.testedEndpoints).toBeGreaterThanOrEqual(2);
  });

  it('still works when llms-txt-exists has not run (no llms.txt URLs)', async () => {
    setupSite('pipe-chh-nollms.local', {
      llmsTxt: '# Docs\n## Links\n- [Page](http://pipe-chh-nollms.local/docs/page): A page\n',
      pages: [{ path: '/docs/page' }],
      cacheControl: 'no-cache',
    });

    // Run only cache-header-hygiene without llms-txt-exists
    const report = await runChecks('http://pipe-chh-nollms.local', {
      checkIds: ['cache-header-hygiene'],
      requestDelay: 0,
    });

    const cacheResult = report.results.find((r) => r.id === 'cache-header-hygiene')!;
    // Should still work — just won't include llms.txt-specific endpoints
    expect(cacheResult.status).not.toBe('error');
    expect(cacheResult.details?.testedEndpoints).toBeGreaterThanOrEqual(1);
  });
});

describe('check pipeline: page-size-markdown mdUrl enrichment', () => {
  it('uses markdown-url-support pageResults to show .md URLs in size report', async () => {
    const mdContent = '# Guide\n\nSome markdown content here.\n';
    setupSite('pipe-mdurl.local', {
      llmsTxt: '# Docs\n## Links\n- [Guide](http://pipe-mdurl.local/docs/guide): Guide\n',
      pages: [{ path: '/docs/guide', md: mdContent }],
    });

    const report = await runChecks('http://pipe-mdurl.local', {
      checkIds: ['llms-txt-exists', 'markdown-url-support', 'page-size-markdown'],
      requestDelay: 0,
    });

    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;
    const pageResults = sizeResult.details?.pageResults as Array<{ url: string; mdUrl: string }>;

    // The mdUrl should be the .md URL, enriched from markdown-url-support results
    expect(pageResults[0].url).toBe('http://pipe-mdurl.local/docs/guide');
    expect(pageResults[0].mdUrl).toBe('http://pipe-mdurl.local/docs/guide.md');
  });
});

describe('check pipeline: content-negotiation respects md-url cache', () => {
  it('preserves md-url content in cache even when CN returns different content', async () => {
    const mdUrlContent = '# Short MD URL version\n';
    const cnContent =
      '# Longer content negotiation version with extra details\n\nMore stuff here.\n';
    setupSite('pipe-preserve.local', {
      llmsTxt: '# Docs\n## Links\n- [Page](http://pipe-preserve.local/docs/page): A page\n',
      pages: [{ path: '/docs/page', md: mdUrlContent, contentNeg: cnContent }],
    });

    const report = await runChecks('http://pipe-preserve.local', {
      checkIds: [
        'llms-txt-exists',
        'markdown-url-support',
        'content-negotiation',
        'page-size-markdown',
      ],
      requestDelay: 0,
    });

    const sizeResult = report.results.find((r) => r.id === 'page-size-markdown')!;
    const pageResults = sizeResult.details?.pageResults as Array<{
      characters: number;
      source: string;
    }>;

    // Should have md-url content (shorter), not CN content (longer)
    expect(pageResults[0].source).toBe('md-url');
    expect(pageResults[0].characters).toBe(mdUrlContent.length);
  });
});

describe('check pipeline: HTML fetch cache shared across checks', () => {
  it('page-size-html and tabbed-content-serialization share fetched HTML', async () => {
    let fetchCount = 0;
    const pageHtml =
      '<html><body><h1>Guide</h1><div class="sphinx-tabs"><div class="sphinx-tabs-tab">Python</div><div class="sphinx-tabs-panel"><pre>print("hi")</pre></div></div></body></html>';

    server.use(
      http.get('http://pipe-htmlcache.local/llms.txt', () =>
        HttpResponse.text(
          '# Docs\n## Links\n- [Guide](http://pipe-htmlcache.local/docs/guide): Guide\n',
        ),
      ),
      http.get(
        'http://pipe-htmlcache.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get('http://pipe-htmlcache.local/docs/guide', () => {
        fetchCount++;
        return new HttpResponse(pageHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }),
      // page-size-html probes for .md and 404-test URLs
      http.get(
        'http://pipe-htmlcache.local/docs/guide.md',
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get(
        'http://pipe-htmlcache.local/docs/guide-afdocs-nonexistent-8f3a',
        () => new HttpResponse('Not Found', { status: 404 }),
      ),
    );

    const report = await runChecks('http://pipe-htmlcache.local', {
      checkIds: ['llms-txt-exists', 'page-size-html', 'tabbed-content-serialization'],
      requestDelay: 0,
    });

    const htmlResult = report.results.find((r) => r.id === 'page-size-html')!;
    const tabResult = report.results.find((r) => r.id === 'tabbed-content-serialization')!;

    // Both checks should succeed
    expect(htmlResult.status).not.toBe('error');
    expect(tabResult.status).not.toBe('error');
    expect(tabResult.details?.totalGroupsFound).toBe(1);

    // The page should only be fetched once, not twice
    expect(fetchCount).toBe(1);
  });
});

describe('check pipeline: independent checks share sampling', () => {
  it('cache-header-hygiene and auth-gate-detection test the same pages', async () => {
    const pages = [];
    const links = [];
    for (let i = 0; i < 20; i++) {
      const path = `/docs/page-${i}`;
      pages.push({ path });
      links.push(`- [Page ${i}](http://pipe-indep.local${path}): Page ${i}`);
    }
    setupSite('pipe-indep.local', {
      llmsTxt: `# Docs\n## Links\n${links.join('\n')}\n`,
      pages,
      cacheControl: 'no-cache',
    });

    const report = await runChecks('http://pipe-indep.local', {
      checkIds: ['llms-txt-exists', 'cache-header-hygiene', 'auth-gate-detection'],
      requestDelay: 0,
      maxLinksToTest: 5,
    });

    const cacheResult = report.results.find((r) => r.id === 'cache-header-hygiene')!;
    const authResult = report.results.find((r) => r.id === 'auth-gate-detection')!;

    expect(cacheResult.details?.totalPages).toBe(20);
    expect(authResult.details?.totalPages).toBe(20);
    expect(authResult.details?.testedPages).toBe(5);

    // cache-header-hygiene tests page URLs + llms.txt URLs, so it tests more endpoints
    // than auth-gate-detection, but the page subset should be the same
    const authPages = (authResult.details?.pageResults as Array<{ url: string }>)
      .map((p) => p.url)
      .sort();

    // cache-header-hygiene endpointResults include the llms.txt URL plus page URLs
    const cacheEndpoints = (cacheResult.details?.endpointResults as Array<{ url: string }>)
      .map((p) => p.url)
      .sort();
    const cachePageUrls = cacheEndpoints.filter((u) => !u.includes('llms.txt')).sort();

    expect(authPages).toEqual(cachePageUrls);
  });
});
