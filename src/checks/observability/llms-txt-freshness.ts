import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'llms-txt-freshness',
    category: 'observability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'llms-txt-freshness',
  category: 'observability',
  description: 'Whether llms.txt reflects the current state of the site',
  dependsOn: ['llms-txt-exists'],
  run: check,
});
