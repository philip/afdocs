import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'http-status-codes',
    category: 'url-stability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'http-status-codes',
  category: 'url-stability',
  description: 'Whether error pages return correct HTTP status codes',
  dependsOn: [],
  run: check,
});
