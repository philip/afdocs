import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'tabbed-content-serialization',
    category: 'content-structure',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'tabbed-content-serialization',
  category: 'content-structure',
  description: 'Whether tabbed/accordion content serializes into oversized output',
  dependsOn: [],
  run: check,
});
