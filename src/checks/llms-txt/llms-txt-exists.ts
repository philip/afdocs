import { registerCheck } from '../registry.js';
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

function isCrossHostRedirect(originalUrl: string, finalUrl: string): boolean {
  try {
    const original = new URL(originalUrl);
    const final_ = new URL(finalUrl);
    return original.host !== final_.host;
  } catch {
    return false;
  }
}

async function checkLlmsTxtExists(ctx: CheckContext): Promise<CheckResult> {
  const candidates = getCandidateUrls(ctx.baseUrl, ctx.origin);
  const discovered: DiscoveredFile[] = [];
  const checkedUrls: Array<{
    url: string;
    status: number;
    redirected: boolean;
    finalUrl?: string;
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
        const looksLikeHtml =
          content.trimStart().startsWith('<!') || content.trimStart().startsWith('<html');
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
    } catch {
      checkedUrls.push({ url, status: 0, redirected: false });
    }
  }

  // Store discovered files for downstream checks
  const details: Record<string, unknown> = {
    candidateUrls: checkedUrls,
    discoveredFiles: discovered,
  };

  if (discovered.length === 0) {
    return {
      id: 'llms-txt-exists',
      category: 'llms-txt',
      status: 'fail',
      message: `No llms.txt found at any candidate location (${candidates.join(', ')})`,
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
      message:
        'llms.txt found but only reachable via cross-host redirect (agents may not follow it)',
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
    message: `llms.txt found at ${discovered.length} location(s)`,
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
