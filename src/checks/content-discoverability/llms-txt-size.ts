import { registerCheck } from '../registry.js';
import { getLlmsTxtFilesForAnalysis } from '../../helpers/llms-txt.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function checkLlmsTxtSize(ctx: CheckContext): Promise<CheckResult> {
  const existsResult = ctx.previousResults.get('llms-txt-exists');
  const discovered = getLlmsTxtFilesForAnalysis(existsResult);

  if (discovered.length === 0) {
    return {
      id: 'llms-txt-size',
      category: 'content-discoverability',
      status: 'skip',
      message: 'No llms.txt files to measure',
      dependsOn: ['llms-txt-exists'],
    };
  }

  const { pass: passThreshold, fail: failThreshold } = ctx.options.thresholds;

  const sizes = discovered.map((f) => ({
    url: f.url,
    characters: f.content.length,
    bytes: new TextEncoder().encode(f.content).byteLength,
  }));

  const details: Record<string, unknown> = { sizes, thresholds: ctx.options.thresholds };

  // Use the worst-case (largest) file for the overall status
  const maxSize = Math.max(...sizes.map((s) => s.characters));

  if (maxSize <= passThreshold) {
    return {
      id: 'llms-txt-size',
      category: 'content-discoverability',
      status: 'pass',
      message: `llms.txt is ${maxSize.toLocaleString()} characters (under ${passThreshold.toLocaleString()} threshold)`,
      details,
    };
  }

  if (maxSize <= failThreshold) {
    return {
      id: 'llms-txt-size',
      category: 'content-discoverability',
      status: 'warn',
      message: `llms.txt is ${maxSize.toLocaleString()} characters (between ${passThreshold.toLocaleString()} and ${failThreshold.toLocaleString()}; consider splitting)`,
      details,
    };
  }

  return {
    id: 'llms-txt-size',
    category: 'content-discoverability',
    status: 'fail',
    message: `llms.txt is ${maxSize.toLocaleString()} characters (exceeds ${failThreshold.toLocaleString()} threshold; will be truncated by most agents)`,
    details,
  };
}

registerCheck({
  id: 'llms-txt-size',
  category: 'content-discoverability',
  description: 'Whether llms.txt fits within agent truncation limits',
  dependsOn: ['llms-txt-exists'],
  run: checkLlmsTxtSize,
});
