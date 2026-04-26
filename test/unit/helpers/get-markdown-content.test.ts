import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createContext } from '../../../src/runner.js';
import { getMarkdownContent } from '../../../src/helpers/get-markdown-content.js';
import type { DiscoveredFile } from '../../../src/types.js';
import { mockSitemapNotFound } from '../../helpers/mock-sitemap-not-found.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

afterEach(() => server.resetHandlers());

describe('getMarkdownContent', () => {
  describe('cached mode (dependency already ran)', () => {
    it('returns cached pages when markdown-url-support passed', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      ctx.previousResults.set('markdown-url-support', {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'pass',
        message: 'Markdown supported',
      });
      ctx.pageCache.set('http://test.local/docs/page1', {
        url: 'http://test.local/docs/page1',
        markdown: { content: '# Page 1\n\nContent.', source: 'md-url' },
      });

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('cached');
      if (result.mode === 'cached') {
        expect(result.depPassed).toBe(true);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].content).toBe('# Page 1\n\nContent.');
        expect(result.pages[0].source).toBe('md-url');
      }
    });

    it('returns cached pages when content-negotiation passed', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      ctx.previousResults.set('content-negotiation', {
        id: 'content-negotiation',
        category: 'markdown-availability',
        status: 'pass',
        message: 'Content negotiation supported',
      });
      ctx.pageCache.set('http://test.local/docs/page1', {
        url: 'http://test.local/docs/page1',
        markdown: { content: '# Page 1', source: 'content-negotiation' },
      });

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('cached');
      if (result.mode === 'cached') {
        expect(result.depPassed).toBe(true);
      }
    });

    it('sets depPassed false when dependency ran but failed', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      ctx.previousResults.set('markdown-url-support', {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'fail',
        message: 'Not supported',
      });

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('cached');
      if (result.mode === 'cached') {
        expect(result.depPassed).toBe(false);
        expect(result.pages).toHaveLength(0);
      }
    });

    it('sets depPassed true when dependency warned', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      ctx.previousResults.set('content-negotiation', {
        id: 'content-negotiation',
        category: 'markdown-availability',
        status: 'warn',
        message: 'Partially supported',
      });
      ctx.pageCache.set('http://test.local/docs/page1', {
        url: 'http://test.local/docs/page1',
        markdown: { content: '# Page 1', source: 'content-negotiation' },
      });

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('cached');
      if (result.mode === 'cached') {
        expect(result.depPassed).toBe(true);
      }
    });

    it('skips cache entries without markdown content', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      ctx.previousResults.set('markdown-url-support', {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'pass',
        message: 'OK',
      });
      ctx.pageCache.set('http://test.local/docs/page1', {
        url: 'http://test.local/docs/page1',
        markdown: { content: '# Has content', source: 'md-url' },
      });
      ctx.pageCache.set('http://test.local/docs/page2', {
        url: 'http://test.local/docs/page2',
        // No markdown field
      });

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('cached');
      expect(result.pages.filter((p) => p.source !== 'llms-txt')).toHaveLength(1);
    });
  });

  describe('llms.txt content collection', () => {
    it('includes llms.txt content from llms-txt-exists result', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      const discovered: DiscoveredFile[] = [
        {
          url: 'http://test.local/llms.txt',
          content: '# Docs\n\n- [Guide](/guide): A guide',
          status: 200,
          redirected: false,
        },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      ctx.previousResults.set('markdown-url-support', {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'pass',
        message: 'OK',
      });

      const result = await getMarkdownContent(ctx);
      const llmsPages = result.pages.filter((p) => p.source === 'llms-txt');
      expect(llmsPages).toHaveLength(1);
      expect(llmsPages[0].url).toBe('http://test.local/llms.txt');
      expect(llmsPages[0].content).toContain('# Docs');
    });

    it('skips discovered files without content', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      const discovered: DiscoveredFile[] = [
        { url: 'http://test.local/llms.txt', status: 200, redirected: false },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      ctx.previousResults.set('markdown-url-support', {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'pass',
        message: 'OK',
      });

      const result = await getMarkdownContent(ctx);
      const llmsPages = result.pages.filter((p) => p.source === 'llms-txt');
      expect(llmsPages).toHaveLength(0);
    });

    it('handles missing llms-txt-exists result', async () => {
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      ctx.previousResults.set('markdown-url-support', {
        id: 'markdown-url-support',
        category: 'markdown-availability',
        status: 'pass',
        message: 'OK',
      });

      const result = await getMarkdownContent(ctx);
      const llmsPages = result.pages.filter((p) => p.source === 'llms-txt');
      expect(llmsPages).toHaveLength(0);
    });
  });

  describe('standalone mode (no dependency ran)', () => {
    it('fetches markdown via .md URL candidates', async () => {
      const llmsTxt = '# Docs\n\n- [Page 1](http://test.local/docs/page1): Page';
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      const discovered: DiscoveredFile[] = [
        { url: 'http://test.local/llms.txt', content: llmsTxt, status: 200, redirected: false },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      mockSitemapNotFound(server, 'http://test.local');

      server.use(
        http.get(
          'http://test.local/docs/page1.md',
          () =>
            new HttpResponse('# Page 1\n\nMarkdown content here.', {
              status: 200,
              headers: { 'Content-Type': 'text/markdown' },
            }),
        ),
      );

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('standalone');
      const fetched = result.pages.filter((p) => p.source === 'standalone-md-url');
      expect(fetched).toHaveLength(1);
      expect(fetched[0].content).toContain('# Page 1');
    });

    it('falls back to content negotiation when .md URLs fail', async () => {
      const llmsTxt = '# Docs\n\n- [Page 1](http://test.local/docs/page1): Page';
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      const discovered: DiscoveredFile[] = [
        { url: 'http://test.local/llms.txt', content: llmsTxt, status: 200, redirected: false },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      mockSitemapNotFound(server, 'http://test.local');

      server.use(
        http.get('http://test.local/docs/page1.md', () => new HttpResponse('', { status: 404 })),
        http.get(
          'http://test.local/docs/page1/index.md',
          () => new HttpResponse('', { status: 404 }),
        ),
        http.get('http://test.local/docs/page1', ({ request }) => {
          const accept = request.headers.get('accept') ?? '';
          if (accept.includes('text/markdown')) {
            return new HttpResponse('# Page 1 via CN\n\nContent.', {
              status: 200,
              headers: { 'Content-Type': 'text/markdown' },
            });
          }
          return new HttpResponse('<html><body>Page 1</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        }),
      );

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('standalone');
      const fetched = result.pages.filter((p) => p.source === 'standalone-content-negotiation');
      expect(fetched).toHaveLength(1);
      expect(fetched[0].content).toContain('# Page 1 via CN');
    });

    it('returns empty when no markdown is available', async () => {
      const llmsTxt = '# Docs\n\n- [Page 1](http://test.local/docs/page1): Page';
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      const discovered: DiscoveredFile[] = [
        { url: 'http://test.local/llms.txt', content: llmsTxt, status: 200, redirected: false },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      mockSitemapNotFound(server, 'http://test.local');

      server.use(
        http.get('http://test.local/docs/page1.md', () => new HttpResponse('', { status: 404 })),
        http.get(
          'http://test.local/docs/page1/index.md',
          () => new HttpResponse('', { status: 404 }),
        ),
        http.get(
          'http://test.local/docs/page1',
          () =>
            new HttpResponse('<html><body>HTML only</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            }),
        ),
      );

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('standalone');
      const fetched = result.pages.filter((p) => p.source !== 'llms-txt');
      expect(fetched).toHaveLength(0);
    });

    it('skips .md URLs that return non-markdown content', async () => {
      const llmsTxt = '# Docs\n\n- [Page 1](http://test.local/docs/page1): Page';
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      const discovered: DiscoveredFile[] = [
        { url: 'http://test.local/llms.txt', content: llmsTxt, status: 200, redirected: false },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      mockSitemapNotFound(server, 'http://test.local');

      server.use(
        http.get(
          'http://test.local/docs/page1.md',
          () =>
            new HttpResponse('<html><body>Not markdown</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            }),
        ),
        http.get(
          'http://test.local/docs/page1/index.md',
          () => new HttpResponse('', { status: 404 }),
        ),
        http.get(
          'http://test.local/docs/page1',
          () =>
            new HttpResponse('<html><body>HTML</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            }),
        ),
      );

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('standalone');
      const fetched = result.pages.filter((p) => p.source !== 'llms-txt');
      expect(fetched).toHaveLength(0);
    });

    it('handles fetch errors gracefully', async () => {
      const llmsTxt = '# Docs\n\n- [Page 1](http://test.local/docs/page1): Page';
      const ctx = createContext('http://test.local', { requestDelay: 0 });
      const discovered: DiscoveredFile[] = [
        { url: 'http://test.local/llms.txt', content: llmsTxt, status: 200, redirected: false },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'content-discoverability',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
      mockSitemapNotFound(server, 'http://test.local');

      server.use(
        http.get('http://test.local/docs/page1.md', () => HttpResponse.error()),
        http.get('http://test.local/docs/page1/index.md', () => HttpResponse.error()),
        http.get('http://test.local/docs/page1', () => HttpResponse.error()),
      );

      const result = await getMarkdownContent(ctx);
      expect(result.mode).toBe('standalone');
      const fetched = result.pages.filter((p) => p.source !== 'llms-txt');
      expect(fetched).toHaveLength(0);
    });
  });
});
