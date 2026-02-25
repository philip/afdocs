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
});
