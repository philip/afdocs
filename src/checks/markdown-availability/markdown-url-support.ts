import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'markdown-url-support',
    category: 'markdown-availability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'markdown-url-support',
  category: 'markdown-availability',
  description: 'Whether appending .md to page URLs returns valid markdown',
  dependsOn: [],
  run: check,
});
