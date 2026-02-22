import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'llms-txt-directive',
    category: 'agent-discoverability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'llms-txt-directive',
  category: 'agent-discoverability',
  description: 'Whether pages include a directive pointing to llms.txt',
  dependsOn: [],
  run: check,
});
