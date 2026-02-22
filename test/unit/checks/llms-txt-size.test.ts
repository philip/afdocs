import { describe, it, expect } from 'vitest';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';
import type { DiscoveredFile } from '../../../src/types.js';

describe('llms-txt-size', () => {
  const check = getCheck('llms-txt-size')!;

  function makeCtx(content: string) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });
    const discovered: DiscoveredFile[] = [
      { url: 'http://test.local/llms.txt', content, status: 200, redirected: false },
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

  it('passes for small content', async () => {
    const result = await check.run(makeCtx('# Small\n\n> Tiny file.\n'));
    expect(result.status).toBe('pass');
  });

  it('warns for content between thresholds', async () => {
    const content = 'x'.repeat(60_000);
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('warn');
  });

  it('fails for content over fail threshold', async () => {
    const content = 'x'.repeat(150_000);
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
  });
});
