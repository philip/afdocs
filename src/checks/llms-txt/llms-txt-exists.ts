import { registerCheck } from '../registry.js';
import { isCrossHostRedirect } from '../../helpers/to-md-urls.js';
import type { CheckContext, CheckResult, DiscoveredFile } from '../../types.js';

/**
 * Build candidate URLs for llms.txt discovery.
 * Per spec: {base_url}/llms.txt, {origin}/llms.txt, {origin}/docs/llms.txt
 * Deduplicates.
 */
function getCandidateUrls(baseUrl: string, origin: string): string[] {
  const candidates = new Set<string>();
  candidates.add(`${baseUrl}/llms.txt`);
  candidates.add(`${origin}/llms.txt`);
  candidates.add(`${origin}/docs/llms.txt`);
  return Array.from(candidates);
}

async function checkLlmsTxtExists(ctx: CheckContext): Promise<CheckResult> {
  const candidates = getCandidateUrls(ctx.baseUrl, ctx.origin);
  const discovered: DiscoveredFile[] = [];
  const checkedUrls: Array<{
    url: string;
    status: number;
    redirected: boolean;
    finalUrl?: string;
    error?: string;
  }> = [];

  for (const url of candidates) {
    try {
      const response = await ctx.http.fetch(url);
      const contentType = response.headers.get('content-type') ?? '';
      const isText = contentType.includes('text/');

      checkedUrls.push({
        url,
        status: response.status,
        redirected: response.redirected,
        finalUrl: response.redirected ? response.url : undefined,
      });

      if (response.ok && isText) {
        const content = await response.text();
        // Check it's not an HTML error page
        const trimmed = content.trimStart().toLowerCase();
        const looksLikeHtml = trimmed.startsWith('<!') || trimmed.startsWith('<html');
        if (!looksLikeHtml && content.trim().length > 0) {
          const crossHost = response.redirected && isCrossHostRedirect(url, response.url);
          discovered.push({
            url,
            content,
            status: response.status,
            redirected: response.redirected,
            redirectUrl: response.redirected ? response.url : undefined,
            crossHostRedirect: crossHost,
          });
        }
      }
    } catch (err) {
      checkedUrls.push({
        url,
        status: 0,
        redirected: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // When no llms.txt found, check if any candidates redirected cross-host.
  // If so, try {redirected_origin}/llms.txt as a fallback.
  const redirectedOrigins: string[] = [];
  if (discovered.length === 0) {
    const checkedSet = new Set(checkedUrls.map((u) => u.url));
    const seenOrigins = new Set<string>();
    for (const checked of checkedUrls) {
      if (checked.finalUrl && isCrossHostRedirect(checked.url, checked.finalUrl)) {
        try {
          const redirectedOrigin = new URL(checked.finalUrl).origin;
          const fallbackUrl = `${redirectedOrigin}/llms.txt`;
          if (!checkedSet.has(fallbackUrl) && !seenOrigins.has(redirectedOrigin)) {
            seenOrigins.add(redirectedOrigin);
            checkedSet.add(fallbackUrl);
            redirectedOrigins.push(redirectedOrigin);
          }
        } catch {
          /* malformed URL */
        }
      }
    }

    for (const redirectedOrigin of redirectedOrigins) {
      const fallbackUrl = `${redirectedOrigin}/llms.txt`;
      try {
        const response = await ctx.http.fetch(fallbackUrl);
        const contentType = response.headers.get('content-type') ?? '';
        const isText = contentType.includes('text/');

        checkedUrls.push({
          url: fallbackUrl,
          status: response.status,
          redirected: response.redirected,
          finalUrl: response.redirected ? response.url : undefined,
        });

        if (response.ok && isText) {
          const content = await response.text();
          const trimmed = content.trimStart().toLowerCase();
          const looksLikeHtml = trimmed.startsWith('<!') || trimmed.startsWith('<html');
          if (!looksLikeHtml && content.trim().length > 0) {
            discovered.push({
              url: fallbackUrl,
              content,
              status: response.status,
              redirected: false,
              crossHostRedirect: true,
            });
          }
        }
      } catch (err) {
        checkedUrls.push({
          url: fallbackUrl,
          status: 0,
          redirected: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const fetchErrors = checkedUrls.filter((u) => u.error).length;
  const rateLimited = checkedUrls.filter((u) => u.status === 429).length;

  const suffix =
    (fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : '') +
    (rateLimited > 0 ? `; ${rateLimited} rate-limited (HTTP 429)` : '');

  // Store discovered files for downstream checks
  const details: Record<string, unknown> = {
    candidateUrls: checkedUrls,
    discoveredFiles: discovered,
    fetchErrors,
    rateLimited,
  };

  if (redirectedOrigins.length > 0) {
    details.redirectedOrigins = redirectedOrigins;
  }

  // Set effectiveOrigin for downstream checks when content lives at a different host.
  // Derive from redirect URLs on discovered files, or from the fallback redirectedOrigins.
  if (!ctx.effectiveOrigin) {
    const crossHostFile = discovered.find((f) => f.crossHostRedirect && f.redirectUrl);
    if (crossHostFile?.redirectUrl) {
      try {
        ctx.effectiveOrigin = new URL(crossHostFile.redirectUrl).origin;
      } catch {
        /* ignore malformed */
      }
    } else if (redirectedOrigins.length > 0) {
      ctx.effectiveOrigin = redirectedOrigins[0];
    }
  }

  if (discovered.length === 0) {
    const redirectNote =
      redirectedOrigins.length > 0
        ? `; candidates redirected cross-host to ${redirectedOrigins.join(', ')} (agents can't follow cross-host redirects)`
        : '';
    return {
      id: 'llms-txt-exists',
      category: 'llms-txt',
      status: 'fail',
      message: `No llms.txt found at any candidate location (${candidates.join(', ')})${redirectNote}${suffix}`,
      details,
    };
  }

  // Check if any discovered files were only reachable via cross-host redirect
  const allCrossHost = discovered.every((f) => f.crossHostRedirect);
  if (allCrossHost) {
    return {
      id: 'llms-txt-exists',
      category: 'llms-txt',
      status: 'warn',
      message: `llms.txt found but only reachable via cross-host redirect (agents may not follow it)${suffix}`,
      details,
    };
  }

  // Note if multiple locations serve different content
  if (discovered.length > 1) {
    const contents = discovered.map((f) => f.content);
    const allSame = contents.every((c) => c === contents[0]);
    details.multipleLocations = true;
    details.sameContent = allSame;
  }

  return {
    id: 'llms-txt-exists',
    category: 'llms-txt',
    status: 'pass',
    message: `llms.txt found at ${discovered.length} location(s)${suffix}`,
    details,
  };
}

registerCheck({
  id: 'llms-txt-exists',
  category: 'llms-txt',
  description: 'Whether llms.txt is discoverable at any of the candidate locations',
  dependsOn: [],
  run: checkLlmsTxtExists,
});
