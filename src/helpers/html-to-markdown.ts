import { parse } from 'node-html-parser';
import TurndownService from 'turndown';
import { tables } from 'turndown-plugin-gfm';

export function htmlToMarkdown(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style')) {
    el.remove();
  }
  const turndown = new TurndownService();
  turndown.use(tables);
  return turndown.turndown(root.toString());
}
