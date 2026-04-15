/**
 * Shared soft-404 detection pattern.
 *
 * Matches common "not found" text in response bodies to detect error pages
 * that return HTTP 200 instead of a proper 4xx status code.
 */
export const SOFT_404_PATTERNS = /not\s*found|page\s*not\s*found|404|does\s*not\s*exist/i;

/**
 * Returns true if the first `limit` characters of `body` match soft-404 patterns.
 */
export function isSoft404Body(body: string, limit = 5000): boolean {
  return SOFT_404_PATTERNS.test(body.slice(0, limit));
}
