import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('markdown-content-parity', () => {
  const check = getCheck('markdown-content-parity')!;

  function makeCtx(
    pages: Array<{ url: string; markdown: string; htmlBody: string }>,
    host: string,
  ) {
    const ctx = createContext(`http://${host}`, { requestDelay: 0 });

    // Simulate upstream markdown-url-support having run
    ctx.previousResults.set('markdown-url-support', {
      id: 'markdown-url-support',
      category: 'markdown-availability',
      status: 'pass',
      message: 'OK',
    });

    // Populate pageCache as upstream checks would
    for (const page of pages) {
      ctx.pageCache.set(page.url, {
        url: page.url,
        markdown: { content: page.markdown, source: 'md-url' },
      });
    }

    return ctx;
  }

  it('passes when markdown and HTML have equivalent content', async () => {
    const html = `<html><body>
      <h1>Getting Started</h1>
      <p>Install the SDK with npm to get started with the integration process.</p>
      <pre><code>npm install @example/sdk</code></pre>
      <p>Then import the client and configure your API key for authentication.</p>
    </body></html>`;
    const markdown = `# Getting Started

Install the SDK with npm to get started with the integration process.

\`\`\`
npm install @example/sdk
\`\`\`

Then import the client and configure your API key for authentication.`;
    const url = 'http://mcp-pass.local/docs/getting-started';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-pass.local');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('warns when markdown is missing some content from HTML', async () => {
    const html = `<html><body>
      <h1>API Reference</h1>
      <p>The API supports the following operations for managing resources.</p>
      <h2>Authentication</h2>
      <p>Use bearer tokens for authentication with the API endpoints.</p>
      <p>Include your API key in the Authorization header of every request.</p>
      <h2>Rate Limiting</h2>
      <p>Requests are limited to 100 per minute per API key.</p>
      <h2>Errors</h2>
      <p>Error responses include a JSON body with details about the failure.</p>
      <p>Each error includes a code field and a human-readable message field.</p>
      <h2>Pagination</h2>
      <p>Use cursor-based pagination with the after parameter in your requests.</p>
      <p>Each page returns up to 50 items by default unless configured otherwise.</p>
      <h2>Versioning</h2>
      <p>Pass the version header to select a specific API version for your requests.</p>
      <p>If no version header is provided the latest stable version is used automatically.</p>
      <h2>Webhooks</h2>
      <p>Configure webhook endpoints to receive real-time notifications about events.</p>
      <p>All webhook payloads include a signature header for verification purposes.</p>
    </body></html>`;

    // Markdown version is missing only the Rate Limiting section (minor omission)
    const markdown = `# API Reference

The API supports the following operations for managing resources.

## Authentication

Use bearer tokens for authentication with the API endpoints.

Include your API key in the Authorization header of every request.

## Errors

Error responses include a JSON body with details about the failure.

Each error includes a code field and a human-readable message field.

## Pagination

Use cursor-based pagination with the after parameter in your requests.

Each page returns up to 50 items by default unless configured otherwise.

## Versioning

Pass the version header to select a specific API version for your requests.

If no version header is provided the latest stable version is used automatically.

## Webhooks

Configure webhook endpoints to receive real-time notifications about events.

All webhook payloads include a signature header for verification purposes.`;

    const url = 'http://mcp-warn.local/docs/api';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-warn.local');
    const result = await check.run(ctx);
    expect(result.status).toBe('warn');
  });

  it('fails when markdown is substantially different from HTML', async () => {
    const html = `<html><body>
      <h1>Installation Guide</h1>
      <p>You need Node.js 18 or later installed on your system before proceeding.</p>
      <p>Create a configuration file with your API credentials and region settings.</p>
      <p>Import and initialize the client using the configuration you just created.</p>
      <p>Run the health check to verify everything is working correctly in your environment.</p>
      <p>Common issues include connection timeouts and authentication failures with expired keys.</p>
      <p>Check your network connectivity if you experience connection timeout errors repeatedly.</p>
      <p>Verify your API key has not expired if you see authentication failure messages.</p>
      <p>Make sure the target host is accessible and responding to network requests properly.</p>
      <p>Review the troubleshooting section for additional debugging information and tips.</p>
      <p>Contact support if you continue to experience issues after following these steps.</p>
      <p>The installation process should take approximately five minutes from start to finish.</p>
    </body></html>`;

    // Markdown version is a completely different page
    const markdown = `# Changelog

## v2.0.0

Breaking changes in this release that affect all existing integrations.

## v1.5.0

Added new features for managing team resources and permissions.

## v1.4.0

Improved error handling and added retry logic for failed requests.`;

    const url = 'http://mcp-fail.local/docs/install';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-fail.local');
    const result = await check.run(ctx);
    expect(result.status).toBe('fail');
    expect(result.details?.avgMissingPercent).toBeGreaterThanOrEqual(20);
  });

  it('skips when no pages have markdown versions', async () => {
    const ctx = createContext('http://mcp-skip.local', { requestDelay: 0 });
    const result = await check.run(ctx);
    expect(result.status).toBe('skip');
  });

  it('handles fetch errors gracefully', async () => {
    const url = 'http://mcp-err.local/docs/page';
    server.use(http.get(url, () => HttpResponse.error()));

    const ctx = makeCtx(
      [
        {
          url,
          markdown: '# Page\n\nThis is some content that is long enough to be a segment.',
          htmlBody: '',
        },
      ],
      'mcp-err.local',
    );
    const result = await check.run(ctx);
    expect(result.details?.fetchErrors).toBe(1);
  });

  it('passes when HTML version is already markdown/plain text', async () => {
    const url = 'http://mcp-plain.local/docs/page';
    const markdown = '# Page\n\nSome content that is at least twenty characters long.';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(markdown, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: markdown }], 'mcp-plain.local');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('detects missing inline code elements', async () => {
    const html = `<html><body>
      <h1>Usage</h1>
      <p>Call the <code>initialize()</code> method first, then use <code>client.fetch()</code> to make requests to the server.</p>
      <p>Set the <code>DEBUG=true</code> environment variable for verbose logging output.</p>
      <p>The client supports automatic retry with exponential backoff for failed requests.</p>
      <p>Configure the maximum number of retries using the <code>maxRetries</code> option parameter.</p>
      <p>All responses include standard headers with rate limiting information for your reference.</p>
      <p>Error responses contain a machine-readable error code and a human-readable description.</p>
      <p>Use the <code>client.close()</code> method to cleanly shut down all connections and resources.</p>
      <p>The library automatically handles connection pooling and keep-alive management for you.</p>
      <p>Requests timeout after thirty seconds by default but this is configurable per request.</p>
      <p>Authentication tokens are refreshed automatically before they expire to prevent failures.</p>
      <p>The client validates all input parameters before sending requests to the remote server.</p>
    </body></html>`;

    // Markdown version lost the inline code content
    const markdown = `# Usage

Call the method first, then use to make requests to the server.

Set the environment variable for verbose logging output.

The client supports automatic retry with exponential backoff for failed requests.

Configure the maximum number of retries using the option parameter.

All responses include standard headers with rate limiting information for your reference.

Error responses contain a machine-readable error code and a human-readable description.

Use the method to cleanly shut down all connections and resources.

The library automatically handles connection pooling and keep-alive management for you.

Requests timeout after thirty seconds by default but this is configurable per request.

Authentication tokens are refreshed automatically before they expire to prevent failures.

The client validates all input parameters before sending requests to the remote server.`;

    const url = 'http://mcp-code.local/docs/usage';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-code.local');
    const result = await check.run(ctx);
    // Should detect the missing inline code content
    expect(result.status).not.toBe('pass');
    const pageResults = result.details?.pageResults as Array<{ missingSegments: number }>;
    expect(pageResults[0].missingSegments).toBeGreaterThan(0);
  });

  it('provides sample diffs in results', async () => {
    const html = `<html><body><h1>Title</h1>
      <p>Original content here that is long enough to count as a segment.</p>
      <p>The system processes incoming requests through a middleware pipeline before routing.</p>
      <p>Each middleware component can inspect and modify the request before passing it along.</p>
      <p>Authentication middleware verifies the bearer token against the identity provider.</p>
      <p>Rate limiting middleware enforces per-client request quotas based on the API key.</p>
      <p>Logging middleware records request metadata for monitoring and debugging purposes.</p>
      <p>Error handling middleware catches unhandled exceptions and returns structured responses.</p>
      <p>Validation middleware checks request bodies against the defined JSON schema rules.</p>
      <p>Compression middleware applies gzip encoding to responses larger than one kilobyte.</p>
      <p>Caching middleware stores frequently accessed responses to reduce backend load times.</p>
      <p>The final handler processes the request and returns the appropriate response data.</p>
    </body></html>`;
    const markdown =
      '# Title\n\nDifferent content here that is long enough to count as a segment.\n\nThe system processes incoming requests through a completely different pipeline.';
    const url = 'http://mcp-diffs.local/docs/page';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-diffs.local');
    const result = await check.run(ctx);
    const pageResults = result.details?.pageResults as Array<{ sampleDiffs: string[] }>;
    expect(pageResults[0].sampleDiffs.length).toBeGreaterThan(0);
  });

  it('compares multiple pages and reports worst status', async () => {
    const goodUrl = 'http://mcp-multi.local/docs/good';
    const badUrl = 'http://mcp-multi.local/docs/bad';

    const goodHtml =
      '<html><body><h1>Good Page</h1><p>Content that matches between HTML and markdown versions exactly.</p></body></html>';
    const goodMd =
      '# Good Page\n\nContent that matches between HTML and markdown versions exactly.';

    const badHtml = `<html><body>
      <h1>Bad Page</h1>
      <p>This page has lots of content that is only in the HTML version.</p>
      <p>Details about section A that should be in the markdown but are missing.</p>
      <p>Details about section B that should be in the markdown but are missing.</p>
      <p>Details about section C that should be in the markdown but are missing.</p>
      <p>Details about section D that should be in the markdown but are missing.</p>
      <p>Details about section E that should be in the markdown but are missing.</p>
    </body></html>`;
    const badMd = '# Bad Page\n\nCompletely different content that does not match the HTML at all.';

    server.use(
      http.get(
        goodUrl,
        () =>
          new HttpResponse(goodHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        badUrl,
        () =>
          new HttpResponse(badHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx(
      [
        { url: goodUrl, markdown: goodMd, htmlBody: goodHtml },
        { url: badUrl, markdown: badMd, htmlBody: badHtml },
      ],
      'mcp-multi.local',
    );
    const result = await check.run(ctx);
    expect(result.details?.pagesCompared).toBe(2);
    expect(result.details?.passBucket).toBeGreaterThanOrEqual(1);
  });

  it('strips navigation panels with high link density', async () => {
    // Simulate a page where nav is inside <main> using <div> instead of <nav>
    const navLinks = Array.from(
      { length: 15 },
      (_, i) => `<a href="/page-${i}">Navigation item number ${i} for testing</a>`,
    ).join('\n');
    const html = `<html><body><main>
      <div class="sidebar">${navLinks}</div>
      <div class="content">
        <h1>Actual Page Content</h1>
        <p>This is the real content that should be compared against markdown output.</p>
        <p>It contains multiple paragraphs with enough text to form segments for comparison.</p>
        <p>The sidebar navigation should be stripped because it has very high link density.</p>
        <p>Without link density stripping the nav text would inflate the missing percentage.</p>
        <p>Each paragraph here represents genuine documentation content for the reader.</p>
        <p>Authentication requires a valid API key passed in the Authorization header field.</p>
        <p>Rate limiting is applied per API key with a maximum of one hundred requests per minute.</p>
        <p>Error responses include a JSON body with a code field and a message field for details.</p>
        <p>Pagination uses cursor-based navigation with the after parameter in query strings.</p>
        <p>The SDK supports automatic retries with exponential backoff for transient failures.</p>
        <p>Configure the maximum number of retries using the maxRetries constructor option.</p>
      </div>
    </main></body></html>`;

    const markdown = `# Actual Page Content

This is the real content that should be compared against markdown output.

It contains multiple paragraphs with enough text to form segments for comparison.

The sidebar navigation should be stripped because it has very high link density.

Without link density stripping the nav text would inflate the missing percentage.

Each paragraph here represents genuine documentation content for the reader.

Authentication requires a valid API key passed in the Authorization header field.

Rate limiting is applied per API key with a maximum of one hundred requests per minute.

Error responses include a JSON body with a code field and a message field for details.

Pagination uses cursor-based navigation with the after parameter in query strings.

The SDK supports automatic retries with exponential backoff for transient failures.

Configure the maximum number of retries using the maxRetries constructor option.`;

    const url = 'http://mcp-nav.local/docs/page';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-nav.local');
    const result = await check.run(ctx);
    // Should pass because nav was stripped; without stripping it would fail
    expect(result.status).toBe('pass');
  });

  it('separates code lines from div-based syntax highlighting', async () => {
    // Simulate Expressive Code / Shiki / Geist code blocks with <div> per line inside <pre>
    const html = `<html><body>
      <h1>Installation Guide</h1>
      <p>Install the package using npm to add it to your project dependencies.</p>
      <p>Then import the client module and configure it with your API credentials.</p>
      <p>Run the following commands to get started with the installation process.</p>
      <pre><code><div class="ec-line"><span style="--0:#fff">npm install @example/sdk</span></div><div class="ec-line"><span style="--0:#fff">npm install @example/cli</span></div></code></pre>
      <p>After installation import the client and call the initialize method first.</p>
      <p>The client will automatically detect your configuration from environment variables.</p>
      <p>You can override any configuration option by passing it to the constructor directly.</p>
      <p>Make sure your API key is set before attempting to make any requests to the server.</p>
      <p>The library validates all configuration options and throws helpful error messages.</p>
      <p>Connection pooling is handled automatically for optimal performance and throughput.</p>
      <p>TLS certificates are verified by default to ensure secure communication channels.</p>
    </body></html>`;

    const markdown = `# Installation Guide

Install the package using npm to add it to your project dependencies.

Then import the client module and configure it with your API credentials.

Run the following commands to get started with the installation process.

\`\`\`
npm install @example/sdk
npm install @example/cli
\`\`\`

After installation import the client and call the initialize method first.

The client will automatically detect your configuration from environment variables.

You can override any configuration option by passing it to the constructor directly.

Make sure your API key is set before attempting to make any requests to the server.

The library validates all configuration options and throws helpful error messages.

Connection pooling is handled automatically for optimal performance and throughput.

TLS certificates are verified by default to ensure secure communication channels.`;

    const url = 'http://mcp-codediv.local/docs/install';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-codediv.local');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('skips pages that return HTTP 404', async () => {
    const url = 'http://mcp-404.local/docs/page';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse('Not Found', {
            status: 404,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx(
      [
        {
          url,
          markdown: '# Page\n\nContent that is long enough for a meaningful segment.',
          htmlBody: '',
        },
      ],
      'mcp-404.local',
    );
    const result = await check.run(ctx);
    // Page should be skipped (auto-pass), not counted as a failure
    const pageResults = result.details?.pageResults as Array<{ error?: string }>;
    expect(pageResults[0].error).toContain('404');
  });

  it('uses heuristic selectors when no semantic container exists', async () => {
    // Page with no <main> or <article>, but has #content
    const html = `<html><body>
      <div class="site-header"><a href="/">Home</a><a href="/docs">Docs</a></div>
      <div id="content">
        <h1>Getting Started Guide</h1>
        <p>This tutorial walks you through the initial setup process for the platform.</p>
        <p>You will need an active account and valid API credentials before proceeding.</p>
        <p>The setup process takes approximately five minutes from start to finish today.</p>
        <p>Begin by installing the command line tool using your preferred package manager.</p>
        <p>After installation run the init command to create a configuration file locally.</p>
        <p>The configuration file stores your API key and preferred region settings securely.</p>
        <p>Next authenticate by running the login command with your account credentials here.</p>
        <p>Once authenticated you can begin making API calls and managing your resources now.</p>
        <p>The dashboard provides a visual overview of all your resources and their status.</p>
        <p>Check the troubleshooting guide if you encounter any issues during the setup.</p>
        <p>Our support team is available around the clock to help with technical questions.</p>
      </div>
      <div class="site-footer">Copyright 2024</div>
    </body></html>`;

    const markdown = `# Getting Started Guide

This tutorial walks you through the initial setup process for the platform.

You will need an active account and valid API credentials before proceeding.

The setup process takes approximately five minutes from start to finish today.

Begin by installing the command line tool using your preferred package manager.

After installation run the init command to create a configuration file locally.

The configuration file stores your API key and preferred region settings securely.

Next authenticate by running the login command with your account credentials here.

Once authenticated you can begin making API calls and managing your resources now.

The dashboard provides a visual overview of all your resources and their status.

Check the troubleshooting guide if you encounter any issues during the setup.

Our support team is available around the clock to help with technical questions.`;

    const url = 'http://mcp-heuristic.local/docs/start';

    server.use(
      http.get(
        url,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = makeCtx([{ url, markdown, htmlBody: html }], 'mcp-heuristic.local');
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });

  it('handles index.md URL by stripping to directory path', async () => {
    const mdUrl = 'http://mcp-index.local/docs/guide/index.md';
    const htmlUrl = 'http://mcp-index.local/docs/guide/';
    const html =
      '<html><body><h1>Guide</h1><p>Step one of the installation process requires downloading the package.</p><p>Step two involves configuring the environment variables for your setup.</p></body></html>';
    const markdown =
      '# Guide\n\nStep one of the installation process requires downloading the package.\n\nStep two involves configuring the environment variables for your setup.';

    server.use(
      http.get(
        htmlUrl,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = createContext('http://mcp-index.local', { requestDelay: 0 });
    ctx.previousResults.set('markdown-url-support', {
      id: 'markdown-url-support',
      category: 'markdown-availability',
      status: 'pass',
      message: 'OK',
    });
    ctx.pageCache.set(mdUrl, {
      url: mdUrl,
      markdown: { content: markdown, source: 'md-url' },
    });

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    const pageResults = result.details?.pageResults as Array<{ totalSegments: number }>;
    expect(pageResults[0].totalSegments).toBeGreaterThan(0);
  });

  it('strips .md from cached URL to fetch the HTML version', async () => {
    const mdUrl = 'http://mcp-mdurl.local/docs/guide.md';
    const htmlUrl = 'http://mcp-mdurl.local/docs/guide';
    const html =
      '<html><body><h1>Guide</h1><p>Step one of the installation process requires downloading the package.</p><p>Step two involves configuring the environment variables for your setup.</p></body></html>';
    const markdown =
      '# Guide\n\nStep one of the installation process requires downloading the package.\n\nStep two involves configuring the environment variables for your setup.';

    server.use(
      http.get(
        mdUrl,
        () =>
          new HttpResponse(markdown, {
            status: 200,
            headers: { 'Content-Type': 'text/markdown' },
          }),
      ),
      http.get(
        htmlUrl,
        () =>
          new HttpResponse(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const ctx = createContext('http://mcp-mdurl.local', { requestDelay: 0 });
    ctx.previousResults.set('markdown-url-support', {
      id: 'markdown-url-support',
      category: 'markdown-availability',
      status: 'pass',
      message: 'OK',
    });
    ctx.pageCache.set(mdUrl, {
      url: mdUrl,
      markdown: { content: markdown, source: 'md-url' },
    });

    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
    const pageResults = result.details?.pageResults as Array<{ totalSegments: number }>;
    expect(pageResults[0].totalSegments).toBeGreaterThan(0);
  });
});
