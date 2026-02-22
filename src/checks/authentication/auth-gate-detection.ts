import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'auth-gate-detection',
    category: 'authentication',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'auth-gate-detection',
  category: 'authentication',
  description: 'Whether documentation pages require authentication to access content',
  dependsOn: [],
  run: check,
});
