/**
 * Broad soft-404 detection pattern.
 *
 * Matches common "not found" text in response bodies. Used by http-status-codes
 * as a hint on pages already suspected of being soft-404s (fabricated bad URLs
 * that returned 200).
 */
export const SOFT_404_PATTERNS = /not\s*found|page\s*not\s*found|404|does\s*not\s*exist/i;

/**
 * Returns true if a markdown response body looks like an error page rather than
 * real content. This is stricter than SOFT_404_PATTERNS because it runs on
 * legitimate page URLs where documentation might naturally mention "404".
 *
 * Detection strategy:
 * 1. If the first markdown heading contains error patterns, it's an error page.
 *    Real error pages say "# Page Not Found"; real docs don't lead with that.
 * 2. If the body is very short (< 500 chars), scan it entirely. Terse error
 *    responses like "Not found" should still be caught.
 */
export function isSoft404Body(body: string): boolean {
  // Check the first markdown heading (e.g. "# Page Not Found")
  const headingMatch = /^#{1,6}\s+(.+)/m.exec(body.slice(0, 500));
  if (headingMatch && SOFT_404_PATTERNS.test(headingMatch[1])) {
    return true;
  }

  // For very short bodies, scan the whole thing. A real page has substantial
  // content; a terse error message like "Not found" or "404" is short.
  if (body.length < 500) {
    return SOFT_404_PATTERNS.test(body);
  }

  return false;
}
