import type { HttpClient, HttpRequestOptions, HttpResponse } from './types.js';

interface RateLimitedHttpClientOptions {
  requestDelay: number;
  requestTimeout: number;
  maxConcurrency: number;
}

export function createHttpClient(options: RateLimitedHttpClientOptions): HttpClient {
  let lastRequestTime = 0;
  let activeRequests = 0;

  async function waitForSlot(): Promise<void> {
    // Wait for concurrency slot
    while (activeRequests >= options.maxConcurrency) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Enforce delay between requests
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < options.requestDelay) {
      await new Promise((resolve) => setTimeout(resolve, options.requestDelay - elapsed));
    }
  }

  return {
    async fetch(url: string, reqOptions?: HttpRequestOptions): Promise<HttpResponse> {
      await waitForSlot();
      activeRequests++;
      lastRequestTime = Date.now();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.requestTimeout);

        const response = await globalThis.fetch(url, {
          method: reqOptions?.method ?? 'GET',
          headers: reqOptions?.headers,
          redirect: reqOptions?.redirect ?? 'follow',
          signal: reqOptions?.signal ?? controller.signal,
        });

        clearTimeout(timeout);

        // Check for Retry-After header
        const retryAfter = response.headers.get('Retry-After');
        if (response.status === 429 && retryAfter) {
          const delaySec = parseInt(retryAfter, 10);
          if (!isNaN(delaySec) && delaySec > 0 && delaySec <= 60) {
            await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
            activeRequests--;
            return this.fetch(url, reqOptions);
          }
        }

        return response as HttpResponse;
      } finally {
        activeRequests--;
      }
    },
  };
}
