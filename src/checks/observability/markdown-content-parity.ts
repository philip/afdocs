import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'markdown-content-parity',
    category: 'observability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'markdown-content-parity',
  category: 'observability',
  description: 'Whether markdown and HTML versions contain equivalent content',
  dependsOn: [['markdown-url-support', 'content-negotiation']],
  run: check,
});
