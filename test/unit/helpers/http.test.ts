import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHttpClient } from '../../../src/http.js';

describe('createHttpClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function makeResponse(status: number, headers?: Record<string, string>): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
      text: async () => '',
    } as unknown as Response;
  }

  it('retries on 429 with Retry-After header', async () => {
    const calls: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      calls.push(Date.now());
      if (calls.length === 1) {
        return makeResponse(429, { 'Retry-After': '1' });
      }
      return makeResponse(200);
    });

    const client = createHttpClient({ requestDelay: 0, requestTimeout: 5000, maxConcurrency: 10 });
    const promise = client.fetch('http://example.com/test');

    // Advance past the 1-second retry delay
    await vi.advanceTimersByTimeAsync(1500);

    const response = await promise;
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('stops retrying after MAX_RETRIES (2) attempts', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return makeResponse(429, { 'Retry-After': '1' });
    });

    const client = createHttpClient({ requestDelay: 0, requestTimeout: 5000, maxConcurrency: 10 });
    const promise = client.fetch('http://example.com/test');

    // Advance through all retries
    await vi.advanceTimersByTimeAsync(5000);

    const response = await promise;
    // 1 initial + 2 retries = 3 calls, then returns the 429
    expect(response.status).toBe(429);
    expect(callCount).toBe(3);
  });

  it('does not retry 429 without Retry-After header', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return makeResponse(429);
    });

    const client = createHttpClient({ requestDelay: 0, requestTimeout: 5000, maxConcurrency: 10 });
    const response = await client.fetch('http://example.com/test');

    expect(response.status).toBe(429);
    expect(callCount).toBe(1);
  });

  it('does not retry 429 when Retry-After exceeds 60 seconds', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return makeResponse(429, { 'Retry-After': '120' });
    });

    const client = createHttpClient({ requestDelay: 0, requestTimeout: 5000, maxConcurrency: 10 });
    const response = await client.fetch('http://example.com/test');

    expect(response.status).toBe(429);
    expect(callCount).toBe(1);
  });

  describe('origin rewriting', () => {
    function makeTextResponse(
      body: string,
      opts: { status?: number; contentType?: string; url?: string; redirected?: boolean } = {},
    ): Response {
      const status = opts.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: 'OK',
        headers: new Headers(opts.contentType ? { 'content-type': opts.contentType } : undefined),
        url: opts.url ?? 'http://preview.local/docs/llms.txt',
        redirected: opts.redirected ?? false,
        text: async () => body,
      } as unknown as Response;
    }

    it('rewrites all occurrences of canonicalOrigin in text responses', async () => {
      const body = [
        '- [Guide](https://prod.example.com/docs/guide)',
        '- [API](https://prod.example.com/docs/api)',
        'All pages: https://prod.example.com/docs/llms.txt',
      ].join('\n');
      globalThis.fetch = vi.fn(async () => makeTextResponse(body, { contentType: 'text/plain' }));

      const client = createHttpClient({
        requestDelay: 0,
        requestTimeout: 5000,
        maxConcurrency: 10,
        canonicalOrigin: 'https://prod.example.com',
        targetOrigin: 'https://preview.local',
      });
      const response = await client.fetch('http://preview.local/docs/llms.txt');
      const text = await response.text();

      expect(text).not.toContain('prod.example.com');
      expect(text).toContain('https://preview.local/docs/guide');
      expect(text).toContain('https://preview.local/docs/api');
      expect(text).toContain('https://preview.local/docs/llms.txt');
    });

    it('preserves url and redirected from original response', async () => {
      globalThis.fetch = vi.fn(async () =>
        makeTextResponse('https://prod.example.com/page', {
          contentType: 'text/plain',
          url: 'http://preview.local/docs/llms.txt',
          redirected: true,
        }),
      );

      const client = createHttpClient({
        requestDelay: 0,
        requestTimeout: 5000,
        maxConcurrency: 10,
        canonicalOrigin: 'https://prod.example.com',
        targetOrigin: 'https://preview.local',
      });
      const response = await client.fetch('http://preview.local/docs/llms.txt');

      expect(response.url).toBe('http://preview.local/docs/llms.txt');
      expect(response.redirected).toBe(true);
    });

    it('skips rewrite for non-text content types', async () => {
      const original = 'https://prod.example.com/binary-data';
      globalThis.fetch = vi.fn(async () =>
        makeTextResponse(original, { contentType: 'application/octet-stream' }),
      );

      const client = createHttpClient({
        requestDelay: 0,
        requestTimeout: 5000,
        maxConcurrency: 10,
        canonicalOrigin: 'https://prod.example.com',
        targetOrigin: 'https://preview.local',
      });
      const response = await client.fetch('http://preview.local/file.bin');
      const text = await response.text();

      expect(text).toBe(original);
    });
  });
});
