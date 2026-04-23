import { describe, it, expect } from 'vitest';
import {
  selectCanonicalLlmsTxt,
  getLlmsTxtFilesForAnalysis,
} from '../../../src/helpers/llms-txt.js';
import type { CheckResult, DiscoveredFile } from '../../../src/types.js';

function file(url: string, content = '# stub'): DiscoveredFile {
  return { url, content, status: 200, redirected: false };
}

describe('selectCanonicalLlmsTxt', () => {
  it('returns undefined for empty input', () => {
    expect(selectCanonicalLlmsTxt([], 'https://example.com')).toBeUndefined();
  });

  it('returns the only file when one is provided', () => {
    const f = file('https://example.com/llms.txt');
    expect(selectCanonicalLlmsTxt([f], 'https://example.com')).toBe(f);
  });

  it('prefers /docs/llms.txt over apex when baseUrl is /docs', () => {
    const apex = file('https://example.com/llms.txt', '# Apex');
    const docs = file('https://example.com/docs/llms.txt', '# Docs');
    const picked = selectCanonicalLlmsTxt([apex, docs], 'https://example.com/docs');
    expect(picked).toBe(docs);
  });

  it('prefers apex over /docs/llms.txt when baseUrl is the origin', () => {
    const apex = file('https://example.com/llms.txt', '# Apex');
    const docs = file('https://example.com/docs/llms.txt', '# Docs');
    const picked = selectCanonicalLlmsTxt([apex, docs], 'https://example.com');
    expect(picked).toBe(apex);
  });

  it('prefers the deepest matching prefix when several files cover baseUrl', () => {
    const apex = file('https://example.com/llms.txt');
    const docs = file('https://example.com/docs/llms.txt');
    const v1 = file('https://example.com/docs/v1/llms.txt');
    const picked = selectCanonicalLlmsTxt([apex, docs, v1], 'https://example.com/docs/v1');
    expect(picked).toBe(v1);
  });

  it('falls back to /docs/llms.txt when /docs/v1/llms.txt is missing', () => {
    const apex = file('https://example.com/llms.txt');
    const docs = file('https://example.com/docs/llms.txt');
    const picked = selectCanonicalLlmsTxt([apex, docs], 'https://example.com/docs/v1');
    expect(picked).toBe(docs);
  });

  it('ignores files on a different origin (treats them as non-prefix matches)', () => {
    const sameOrigin = file('https://example.com/llms.txt');
    const otherOrigin = file('https://other.com/docs/llms.txt');
    const picked = selectCanonicalLlmsTxt([otherOrigin, sameOrigin], 'https://example.com/docs');
    expect(picked).toBe(sameOrigin);
  });

  it('handles trailing slashes on baseUrl gracefully', () => {
    const apex = file('https://example.com/llms.txt');
    const docs = file('https://example.com/docs/llms.txt');
    const picked = selectCanonicalLlmsTxt([apex, docs], 'https://example.com/docs/');
    expect(picked).toBe(docs);
  });

  it('does not pick /docs/llms.txt when baseUrl is /api (different subtree)', () => {
    const apex = file('https://example.com/llms.txt');
    const docs = file('https://example.com/docs/llms.txt');
    const picked = selectCanonicalLlmsTxt([apex, docs], 'https://example.com/api');
    expect(picked).toBe(apex);
  });

  it('falls back to non-prefix file when nothing matches', () => {
    const apiFile = file('https://example.com/api/llms.txt');
    const picked = selectCanonicalLlmsTxt([apiFile], 'https://example.com/docs');
    expect(picked).toBe(apiFile);
  });
});

describe('getLlmsTxtFilesForAnalysis', () => {
  function makeResult(details: Record<string, unknown>): CheckResult {
    return {
      id: 'llms-txt-exists',
      category: 'content-discoverability',
      status: 'pass',
      message: 'ok',
      details,
    };
  }

  it('returns empty array when result is undefined', () => {
    expect(getLlmsTxtFilesForAnalysis(undefined)).toEqual([]);
  });

  it('returns empty array when result has no details', () => {
    const res: CheckResult = {
      id: 'llms-txt-exists',
      category: 'content-discoverability',
      status: 'fail',
      message: 'no',
    };
    expect(getLlmsTxtFilesForAnalysis(res)).toEqual([]);
  });

  it('returns canonical when present', () => {
    const canonical = file('https://example.com/docs/llms.txt');
    const other = file('https://example.com/llms.txt');
    const res = makeResult({
      canonicalLlmsTxt: canonical,
      discoveredFiles: [other, canonical],
    });
    expect(getLlmsTxtFilesForAnalysis(res)).toEqual([canonical]);
  });

  it('falls back to discoveredFiles when no canonical (legacy callers)', () => {
    const a = file('https://example.com/llms.txt');
    const b = file('https://example.com/docs/llms.txt');
    const res = makeResult({ discoveredFiles: [a, b] });
    expect(getLlmsTxtFilesForAnalysis(res)).toEqual([a, b]);
  });
});
