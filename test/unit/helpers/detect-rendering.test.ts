import { describe, it, expect } from 'vitest';
import { analyzeRendering } from '../../../src/helpers/detect-rendering.js';

describe('analyzeRendering', () => {
  it('passes for traditional server-rendered HTML with no SPA markers', () => {
    const html =
      '<html><body><h1>Hello World</h1><p>' +
      'Real content here. '.repeat(20) +
      '</p></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(true);
    expect(result.hasSpaMarkers).toBe(false);
  });

  it('passes for SSR site with Next.js marker and real content', () => {
    // Simulates GitHub docs: __next marker but real headings and paragraphs
    const html =
      '<html><body><div id="__next">' +
      '<main>' +
      '<h1>REST API</h1>' +
      '<h2>Authentication</h2>' +
      '<h3>Rate Limits</h3>' +
      '<p>You can authenticate to the REST API to access more endpoints.</p>' +
      '<p>Learn how to use the GitHub REST API effectively.</p>' +
      '<p>Follow these best practices when using the API.</p>' +
      '<p>Check out our development quickstart guide for details.</p>' +
      '<p>You can use OAuth tokens or personal access tokens.</p>' +
      '</main>' +
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(true);
    expect(result.hasSpaMarkers).toBe(true);
    expect(result.spaMarker).toBe('id="__next"');
    expect(result.contentHeadings).toBe(3);
  });

  it('fails for Gatsby SPA shell with no content', () => {
    const html =
      '<html><head><style>' +
      'x'.repeat(15_000) +
      '</style></head><body><div id="___gatsby"></div>' +
      '<script>window.__stuff=true</script></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(false);
    expect(result.hasSpaMarkers).toBe(true);
    expect(result.spaMarker).toBe('id="___gatsby"');
    expect(result.contentHeadings).toBe(0);
    expect(result.contentParagraphs).toBe(0);
  });

  it('fails for SPA shell with only nav chrome text', () => {
    // Simulates MongoDB: ___gatsby marker, nav links, no real content
    const navText = 'Products Platform Atlas Database Search Tools Documentation ';
    const html =
      '<html><head><style>' +
      'x'.repeat(50_000) +
      '</style></head>' +
      '<body><div id="___gatsby">' +
      '<nav>' +
      navText.repeat(5) +
      '</nav>' +
      '<script>' +
      'y'.repeat(200_000) +
      '</script>' +
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(false);
    expect(result.hasSpaMarkers).toBe(true);
    expect(result.contentHeadings).toBe(0);
  });

  it('passes for SSR site with heavy assets but main content region', () => {
    // Simulates Stripe docs: low text ratio but real content inside <main>
    const html =
      '<html><head><style>' +
      'x'.repeat(100_000) +
      '</style></head>' +
      '<body><div id="root">' +
      '<main>' +
      '<h1>API Reference</h1>' +
      '<p>You can use the Stripe API in test mode, which does not affect your live data.</p>' +
      '<p>The API supports both synchronous and asynchronous request patterns for flexibility.</p>' +
      '</main>' +
      '<script>' +
      'y'.repeat(500_000) +
      '</script>' +
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(true);
    expect(result.hasSpaMarkers).toBe(true);
    expect(result.hasMainContent).toBe(true);
  });

  it('fails for SPA shell with main element but only breadcrumbs', () => {
    // Simulates MongoDB Atlas Search tutorial: <main> exists but has only title + breadcrumbs
    const html =
      '<html><head><style>' +
      'x'.repeat(50_000) +
      '</style></head>' +
      '<body><div id="___gatsby">' +
      '<main>' +
      '<h1>MongoDB Search Quick Start</h1>' +
      '<nav>Docs Home / Development / Search</nav>' +
      '</main>' +
      '<script>' +
      'y'.repeat(200_000) +
      '</script>' +
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(false);
    expect(result.hasSpaMarkers).toBe(true);
    expect(result.hasMainContent).toBe(false);
  });

  it('passes for Next.js SSG site with multiple headings', () => {
    const html =
      '<html><body><div id="__next">' +
      '<h1>Getting Started</h1>' +
      '<h2>Installation</h2>' +
      '<h2>Configuration</h2>' +
      '<h2>Usage</h2>' +
      '<p>Welcome to our documentation.</p>' +
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(true);
    expect(result.contentHeadings).toBe(4);
  });

  it('detects __nuxt marker', () => {
    const html = '<html><body><div id="__nuxt"></div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasSpaMarkers).toBe(true);
    expect(result.spaMarker).toBe('id="__nuxt"');
    expect(result.hasContent).toBe(false);
  });

  it('counts code blocks as content signals', () => {
    const html =
      '<html><body><div id="__next">' +
      '<pre><code>const x = 1;</code></pre>' +
      '<pre><code>const y = 2;</code></pre>' +
      '<pre><code>const z = 3;</code></pre>' +
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasContent).toBe(true);
    expect(result.codeBlocks).toBeGreaterThanOrEqual(3);
  });

  it('does not count very short headings (nav labels)', () => {
    const html =
      '<html><body><div id="___gatsby">' +
      '<h3>API</h3>' + // 3 chars, should be excluded
      '<h3>FAQ</h3>' + // 3 chars, should be excluded
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.contentHeadings).toBe(0);
    expect(result.hasContent).toBe(false);
  });

  it('passes for div-soup SSR site with substantial visible text but no semantic tags', () => {
    // Simulates Archbee's Next.js renderer: __next marker, content wrapped in
    // <div>/<span> rather than <p>/<main>/<h2>, but full prose is server-rendered.
    const prose =
      'Callout is your megaphone for shouting at someone. ' +
      'Use it to highlight important information that readers should not miss. '.repeat(40);
    const html =
      '<html><body><div id="__next">' +
      '<div><h1>Callout</h1></div>' +
      '<div><span>' +
      prose +
      '</span></div>' +
      '</div></body></html>';
    const result = analyzeRendering(html);
    expect(result.hasSpaMarkers).toBe(true);
    expect(result.spaMarker).toBe('id="__next"');
    expect(result.contentParagraphs).toBe(0);
    expect(result.hasMainContent).toBe(false);
    expect(result.visibleTextLength).toBeGreaterThanOrEqual(1500);
    expect(result.hasContent).toBe(true);
  });

  it('handles empty HTML', () => {
    const result = analyzeRendering('');
    expect(result.hasContent).toBe(true); // No SPA markers = assume content
    expect(result.hasSpaMarkers).toBe(false);
  });
});
