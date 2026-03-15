/**
 * Returns true if the two URLs have different hosts (i.e. a cross-host redirect).
 */
export function isCrossHostRedirect(originalUrl: string, finalUrl: string): boolean {
  try {
    const original = new URL(originalUrl);
    const final_ = new URL(finalUrl);
    return original.host !== final_.host;
  } catch {
    return false;
  }
}

/**
 * Returns true if the URL points to a non-page file type (e.g. .json, .xml, .txt)
 * where we would not expect a markdown equivalent.
 */
export function isNonPageUrl(url: string): boolean {
  const parsed = new URL(url);
  const lastSegment = parsed.pathname.split('/').pop() ?? '';
  // Has a file extension that isn't .html/.htm/.md/.mdx
  return (
    /\.[a-z0-9]+$/i.test(lastSegment) &&
    !/\.html?$/i.test(lastSegment) &&
    !lastSegment.endsWith('.md') &&
    !lastSegment.endsWith('.mdx')
  );
}

/**
 * Generate candidate .md URLs for a page URL.
 * If the URL already ends in .md, return it as-is.
 * Otherwise try both `/docs/guide.md` and `/docs/guide/index.md`.
 */
export function toMdUrls(url: string): string[] {
  const parsed = new URL(url);

  // URL already points to a .md or .mdx file — use it directly
  if (parsed.pathname.endsWith('.md') || parsed.pathname.endsWith('.mdx')) {
    return [url];
  }

  // Non-page file extension (e.g. .txt, .json, .xml) — no .md equivalent
  if (isNonPageUrl(url)) {
    return [];
  }

  const pathname = parsed.pathname.replace(/\/$/, '') || '';
  const candidates: string[] = [];

  // /docs/guide.md (strip .html extension if present)
  const directMd = new URL(parsed.toString());
  directMd.pathname = pathname.replace(/\.html?$/, '') + '.md';
  candidates.push(directMd.toString());

  // /docs/guide/index.md
  const indexMd = new URL(parsed.toString());
  indexMd.pathname = pathname + '/index.md';
  candidates.push(indexMd.toString());

  return candidates;
}
