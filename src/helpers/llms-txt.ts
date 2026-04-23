import type { CheckResult, DiscoveredFile } from '../types.js';

/**
 * Get the directory portion of a URL's pathname (the part before the filename),
 * without a trailing slash. Returns '' for root-level files.
 *
 *   /llms.txt          -> ''
 *   /docs/llms.txt     -> '/docs'
 *   /docs/v1/llms.txt  -> '/docs/v1'
 */
function getFileDir(fileUrl: string): string {
  try {
    const path = new URL(fileUrl).pathname;
    const dir = path.replace(/\/[^/]*$/, '');
    return dir === '/' ? '' : dir;
  } catch {
    return '';
  }
}

/**
 * Returns true when the file's directory is a (non-strict) prefix of the
 * baseUrl's pathname AND the origins match. Files on a different origin
 * (e.g. discovered via cross-host redirect fallback) never qualify here.
 */
function fileDirIsPrefixOfBase(fileUrl: string, baseUrl: string): boolean {
  try {
    const f = new URL(fileUrl);
    const b = new URL(baseUrl);
    if (f.origin !== b.origin) return false;
    const fileDir = getFileDir(fileUrl);
    const basePath = b.pathname.replace(/\/$/, '');
    if (fileDir === '') return true;
    return fileDir === basePath || basePath.startsWith(fileDir + '/');
  } catch {
    return false;
  }
}

function scoreCandidate(fileUrl: string, baseUrl: string): number {
  // Files whose directory is a prefix of baseUrl rank above everything else.
  // Within that group, deeper directories (more specific) rank higher.
  // The +1 ensures any prefix match outranks a non-prefix match (which scores 0).
  if (!fileDirIsPrefixOfBase(fileUrl, baseUrl)) return 0;
  return 1 + getFileDir(fileUrl).length;
}

/**
 * Pick the canonical llms.txt from a set of discovered files.
 *
 * Priority:
 *   1. The file whose directory is the longest prefix of the baseUrl's
 *      pathname (most specific to what the user passed).
 *   2. Files whose directory is *not* a prefix of the baseUrl rank below
 *      any prefix-matching file (they cover different parts of the site).
 *   3. Ties resolved by registration order — i.e. the order returned by
 *      the candidate discovery, which already lists baseUrl > origin > docs.
 *
 * Examples (assuming both files exist):
 *   baseUrl https://example.com/docs        -> /docs/llms.txt wins over /llms.txt
 *   baseUrl https://example.com             -> /llms.txt wins over /docs/llms.txt
 *   baseUrl https://example.com/docs/v1     -> /docs/v1/llms.txt > /docs/llms.txt > /llms.txt
 */
export function selectCanonicalLlmsTxt(
  discovered: DiscoveredFile[],
  baseUrl: string,
): DiscoveredFile | undefined {
  if (discovered.length === 0) return undefined;
  if (discovered.length === 1) return discovered[0];

  let best = discovered[0];
  let bestScore = scoreCandidate(best.url, baseUrl);

  for (let i = 1; i < discovered.length; i++) {
    const score = scoreCandidate(discovered[i].url, baseUrl);
    if (score > bestScore) {
      best = discovered[i];
      bestScore = score;
    }
  }

  return best;
}

/**
 * Pick the discovered llms.txt file(s) that downstream checks should treat
 * as the source of truth for sampling links, measuring size, validating
 * structure, etc.
 *
 * When `llms-txt-exists` selected a canonical file (the common case), only
 * that file is returned. Falls back to the full `discoveredFiles` array for
 * backward compatibility with callers (e.g. unit tests) that populate
 * `previousResults` directly without going through `llms-txt-exists`.
 *
 * Returns an empty array when no llms.txt is available.
 */
export function getLlmsTxtFilesForAnalysis(
  existsResult: CheckResult | undefined,
): DiscoveredFile[] {
  if (!existsResult?.details) return [];
  const canonical = existsResult.details.canonicalLlmsTxt as DiscoveredFile | undefined;
  if (canonical) return [canonical];
  return (existsResult.details.discoveredFiles as DiscoveredFile[] | undefined) ?? [];
}
