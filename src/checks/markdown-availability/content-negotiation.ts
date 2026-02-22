import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'content-negotiation',
    category: 'markdown-availability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'content-negotiation',
  category: 'markdown-availability',
  description: 'Whether the server responds to Accept: text/markdown',
  dependsOn: [],
  run: check,
});
