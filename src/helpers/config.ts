import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AgentDocsConfig } from '../types.js';

const CONFIG_FILENAMES = ['agent-docs.config.yml', 'agent-docs.config.yaml'];

/**
 * Search for an agent-docs config file starting from `dir` and walking up
 * to the filesystem root (like eslint, prettier, etc.).
 * If `dir` is omitted, starts from `process.cwd()`.
 */
export async function loadConfig(dir?: string): Promise<AgentDocsConfig> {
  let searchDir = resolve(dir ?? process.cwd());

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const filepath = resolve(searchDir, filename);
      try {
        const content = await readFile(filepath, 'utf-8');
        const parsed = parseYaml(content) as AgentDocsConfig;
        if (!parsed.url) {
          throw new Error(`Config file ${filepath} is missing required "url" field`);
        }
        return parsed;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
    }

    const parent = dirname(searchDir);
    if (parent === searchDir) break; // reached filesystem root
    searchDir = parent;
  }

  throw new Error(
    `No agent-docs config file found. Create ${CONFIG_FILENAMES[0]} with at least a "url" field.`,
  );
}
