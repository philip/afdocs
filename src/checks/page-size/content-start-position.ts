import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'content-start-position',
    category: 'page-size',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'content-start-position',
  category: 'page-size',
  description: 'How far into content the actual documentation begins',
  dependsOn: [],
  run: check,
});
