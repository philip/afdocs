const HTML_PATTERNS = [/<!doctype\s/i, /<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i];

const MD_HEADING = /^#{1,6}\s+\S/m;
const MD_LINK = /\[[^\]]+\]\([^)]+\)/;
const MD_CODE_FENCE = /^```/m;

/**
 * Returns true if the body looks like HTML (contains DOCTYPE, <html>, <head>, or <body> tags).
 */
export function looksLikeHtml(body: string): boolean {
  const sample = body.slice(0, 2000);
  return HTML_PATTERNS.some((p) => p.test(sample));
}

/**
 * Returns true if the body looks like markdown content (has headings, links, or code fences)
 * and does NOT look like HTML.
 */
export function looksLikeMarkdown(body: string): boolean {
  if (looksLikeHtml(body)) return false;

  const sample = body.slice(0, 5000);
  let signals = 0;
  if (MD_HEADING.test(sample)) signals++;
  if (MD_LINK.test(sample)) signals++;
  if (MD_CODE_FENCE.test(sample)) signals++;

  return signals >= 1;
}
