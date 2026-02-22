import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'section-header-quality',
    category: 'content-structure',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'section-header-quality',
  category: 'content-structure',
  description: 'Whether headers in tabbed sections include variant context',
  dependsOn: ['tabbed-content-serialization'],
  run: check,
});
