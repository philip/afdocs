import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AgentDocsConfig } from '../types.js';

const CONFIG_FILENAMES = ['agent-docs.config.yml', 'agent-docs.config.yaml'];

export async function loadConfig(dir?: string): Promise<AgentDocsConfig> {
  const searchDir = dir ?? process.cwd();

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

  throw new Error(
    `No agent-docs config file found. Create ${CONFIG_FILENAMES[0]} with at least a "url" field.`,
  );
}
