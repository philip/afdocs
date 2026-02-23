/**
 * Generate candidate .md URLs for a page URL.
 * If the URL already ends in .md, return it as-is.
 * Otherwise try both `/docs/guide.md` and `/docs/guide/index.md`.
 */
export function toMdUrls(url: string): string[] {
  const parsed = new URL(url);

  // URL already points to a .md file — use it directly
  if (parsed.pathname.endsWith('.md')) {
    return [url];
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
