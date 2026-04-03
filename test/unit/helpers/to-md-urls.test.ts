import { describe, it, expect } from 'vitest';
import { isCrossHostRedirect, toMdUrls } from '../../../src/helpers/to-md-urls.js';

describe('toMdUrls', () => {
  it('returns URL as-is when it already ends in .md', () => {
    expect(toMdUrls('https://example.com/docs/guide.md')).toEqual([
      'https://example.com/docs/guide.md',
    ]);
  });

  it('generates path.md and path/index.md candidates', () => {
    expect(toMdUrls('https://example.com/docs/guide')).toEqual([
      'https://example.com/docs/guide.md',
      'https://example.com/docs/guide/index.md',
    ]);
  });

  it('strips trailing slash before generating candidates', () => {
    expect(toMdUrls('https://example.com/docs/')).toEqual([
      'https://example.com/docs.md',
      'https://example.com/docs/index.md',
    ]);
  });

  it('strips .html extension before appending .md', () => {
    expect(toMdUrls('https://example.com/guide.html')).toEqual([
      'https://example.com/guide.md',
      'https://example.com/guide.html/index.md',
    ]);
  });

  it('strips .htm extension before appending .md', () => {
    expect(toMdUrls('https://example.com/guide.htm')).toEqual([
      'https://example.com/guide.md',
      'https://example.com/guide.htm/index.md',
    ]);
  });

  it('handles root URL', () => {
    const result = toMdUrls('https://example.com/');
    expect(result).toEqual(['https://example.com/.md', 'https://example.com/index.md']);
  });

  it('preserves query and fragment', () => {
    const result = toMdUrls('https://example.com/docs/guide?v=2');
    expect(result[0]).toBe('https://example.com/docs/guide.md?v=2');
  });

  it('returns URL as-is when it already ends in .mdx', () => {
    expect(toMdUrls('https://example.com/docs/guide.mdx')).toEqual([
      'https://example.com/docs/guide.mdx',
    ]);
  });

  it('returns empty array for .txt files', () => {
    expect(toMdUrls('https://example.com/docs/llms.txt')).toEqual([]);
  });

  it('returns empty array for .json files', () => {
    expect(toMdUrls('https://example.com/api/schema.json')).toEqual([]);
  });

  it('returns empty array for .xml files', () => {
    expect(toMdUrls('https://example.com/sitemap.xml')).toEqual([]);
  });
});

describe('isCrossHostRedirect', () => {
  it('returns false for same host', () => {
    expect(isCrossHostRedirect('https://example.com/a', 'https://example.com/b')).toBe(false);
  });

  it('returns false for www to bare domain', () => {
    expect(isCrossHostRedirect('https://www.example.com/a', 'https://example.com/a')).toBe(false);
  });

  it('returns false for bare domain to www', () => {
    expect(
      isCrossHostRedirect(
        'https://mongodb.com/docs/llms.txt',
        'https://www.mongodb.com/docs/llms.txt',
      ),
    ).toBe(false);
  });

  it('returns true for genuinely different hosts', () => {
    expect(isCrossHostRedirect('https://example.com/a', 'https://other.com/a')).toBe(true);
  });

  it('returns true for different subdomains (not www)', () => {
    expect(isCrossHostRedirect('https://docs.example.com/a', 'https://api.example.com/a')).toBe(
      true,
    );
  });

  it('returns false for malformed URLs', () => {
    expect(isCrossHostRedirect('not-a-url', 'https://example.com')).toBe(false);
  });
});
