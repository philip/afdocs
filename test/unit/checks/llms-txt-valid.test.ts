import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractMarkdownLinks } from '../../../src/checks/content-discoverability/llms-txt-valid.js';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';
import type { DiscoveredFile } from '../../../src/types.js';

const FIXTURES = resolve(import.meta.dirname, '../../fixtures/llms-txt');

describe('extractMarkdownLinks', () => {
  it('extracts links from markdown', () => {
    const content = '- [Foo](https://example.com/foo): A foo\n- [Bar](https://example.com/bar)';
    const links = extractMarkdownLinks(content);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ name: 'Foo', url: 'https://example.com/foo' });
    expect(links[1]).toEqual({ name: 'Bar', url: 'https://example.com/bar' });
  });

  it('returns empty array for no links', () => {
    expect(extractMarkdownLinks('Just some text')).toHaveLength(0);
  });

  it('strips title attributes from single-line links', () => {
    const content = '- [Cloud](/path/to/page/ "View the Cloud version")';
    const links = extractMarkdownLinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ name: 'Cloud', url: '/path/to/page/' });
  });

  it('strips title attributes from multi-line links', () => {
    const content = '- [Cloud](/path/to/page/\n   "View the Cloud version")';
    const links = extractMarkdownLinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ name: 'Cloud', url: '/path/to/page/' });
  });

  it('strips single-quoted title attributes', () => {
    const content = "- [Docs](/docs/ 'Documentation')";
    const links = extractMarkdownLinks(content);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ name: 'Docs', url: '/docs/' });
  });
});

describe('llms-txt-valid', () => {
  const check = getCheck('llms-txt-valid')!;

  async function runWithContent(content: string) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });
    const discovered: DiscoveredFile[] = [
      { url: 'http://test.local/llms.txt', content, status: 200, redirected: false },
    ];
    ctx.previousResults.set('llms-txt-exists', {
      id: 'llms-txt-exists',
      category: 'content-discoverability',
      status: 'pass',
      message: 'Found',
      details: { discoveredFiles: discovered },
    });
    return check.run(ctx);
  }

  it('passes for valid llms.txt', async () => {
    const content = await readFile(resolve(FIXTURES, 'valid.txt'), 'utf-8');
    const result = await runWithContent(content);
    expect(result.status).toBe('pass');
  });

  it('warns for llms.txt without H1', async () => {
    const content = await readFile(resolve(FIXTURES, 'no-h1.txt'), 'utf-8');
    const result = await runWithContent(content);
    expect(result.status).toBe('warn');
  });

  it('fails for llms.txt with no links', async () => {
    const content = await readFile(resolve(FIXTURES, 'no-links.txt'), 'utf-8');
    const result = await runWithContent(content);
    expect(result.status).toBe('fail');
  });
});
