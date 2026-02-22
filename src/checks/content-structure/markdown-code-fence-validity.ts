import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(_ctx: CheckContext): Promise<CheckResult> {
  return {
    id: 'markdown-code-fence-validity',
    category: 'content-structure',
    status: 'skip',
    message: 'Not yet implemented',
  };
}

registerCheck({
  id: 'markdown-code-fence-validity',
  category: 'content-structure',
  description: 'Whether markdown contains unclosed code fences',
  dependsOn: [['markdown-url-support', 'content-negotiation']],
  run: check,
});
