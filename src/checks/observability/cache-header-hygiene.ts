import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'cache-header-hygiene',
    category: 'observability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'cache-header-hygiene',
  category: 'observability',
  description: 'Whether cache headers allow timely updates',
  dependsOn: [],
  run: check,
});
