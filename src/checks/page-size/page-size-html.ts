import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'page-size-html',
    category: 'page-size',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'page-size-html',
  category: 'page-size',
  description: 'Character count of HTML response and post-conversion size',
  dependsOn: [],
  run: check,
});
