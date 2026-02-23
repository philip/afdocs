import TurndownService from 'turndown';

/**
 * Convert HTML to markdown using Turndown with default configuration.
 * Matches real agent behavior per the Agent-Friendly Documentation Spec:
 * no explicit <style>/<script> stripping, default options only.
 */
export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService();
  return turndown.turndown(html);
}
