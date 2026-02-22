import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'redirect-behavior',
    category: 'url-stability',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'redirect-behavior',
  category: 'url-stability',
  description: 'Whether redirects are same-host HTTP redirects',
  dependsOn: [],
  run: check,
});
