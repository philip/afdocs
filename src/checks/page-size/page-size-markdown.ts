import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'page-size-markdown',
    category: 'page-size',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'page-size-markdown',
  category: 'page-size',
  description: 'Character count of page when served as markdown',
  dependsOn: [['markdown-url-support', 'content-negotiation']],
  run: check,
});
