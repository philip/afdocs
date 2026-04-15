import TurndownService from 'turndown';
import { tables } from 'turndown-plugin-gfm';

/**
 * Convert HTML to markdown using Turndown with default configuration.
 * Matches real agent behavior per the Agent-Friendly Documentation Spec:
 * no explicit <style>/<script> stripping, default options only.
 * The GFM tables plugin is enabled so HTML tables are preserved as markdown
 * tables rather than being flattened to plain text.
 */
export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService();
  turndown.use(tables);
  return turndown.turndown(html);
}
