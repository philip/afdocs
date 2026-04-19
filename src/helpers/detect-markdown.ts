const HTML_PATTERNS = [/<!doctype\s/i, /<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i];

const MD_HEADING = /^#{1,6}\s+\S/m;
const MD_LINK = /\[[^\]]+\]\([^)]+\)/;
const MD_CODE_FENCE = /^```/m;

/**
 * Strip fenced code blocks and inline code spans so that HTML tags mentioned
 * inside code (e.g. `<body>` or a fenced HTML snippet) don't produce false
 * positives when checking for HTML patterns.
 */
function stripCode(text: string): string {
  // Strip fenced code blocks (``` or ~~~, with optional language tag)
  text = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '');
  // Strip inline code spans
  text = text.replace(/`[^`\n]+`/g, '``');
  return text;
}

/**
 * Returns true if the body looks like HTML (contains DOCTYPE, <html>, <head>, or <body> tags).
 * Fenced code blocks and inline code spans are stripped first to avoid false positives
 * from markdown that mentions HTML tags in code examples.
 */
export function looksLikeHtml(body: string): boolean {
  const sample = stripCode(body.slice(0, 2000));
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
