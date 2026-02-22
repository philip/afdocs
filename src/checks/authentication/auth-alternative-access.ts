import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'auth-alternative-access',
    category: 'authentication',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'auth-alternative-access',
  category: 'authentication',
  description:
    'Whether an auth-gated documentation site provides alternative access paths for agents',
  dependsOn: [['auth-gate-detection']],
  run: check,
});
