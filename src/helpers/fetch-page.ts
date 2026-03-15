import { looksLikeHtml } from './detect-markdown.js';
import type { CheckContext, FetchedPage } from '../types.js';

/**
 * Fetch a page URL, returning the body and content-type metadata.
 * Results are cached on `ctx.htmlCache` so that multiple checks
 * within the same run avoid redundant HTTP requests.
 */
export async function fetchPage(ctx: CheckContext, url: string): Promise<FetchedPage> {
  const cached = ctx.htmlCache.get(url);
  if (cached) return cached;

  const response = await ctx.http.fetch(url);
  const body = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const isMarkdownType =
    contentType.includes('text/markdown') || contentType.includes('text/plain');
  const isHtml = !isMarkdownType && (contentType.includes('text/html') || looksLikeHtml(body));

  const result: FetchedPage = { url, status: response.status, body, contentType, isHtml };
  ctx.htmlCache.set(url, result);
  return result;
}
