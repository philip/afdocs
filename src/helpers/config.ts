import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AgentDocsConfig, PageConfigEntry } from '../types.js';

const CONFIG_FILENAMES = ['agent-docs.config.yml', 'agent-docs.config.yaml'];

/**
 * Validate the `pages` field in a config file.
 * Each entry must be a valid URL string or an object with a valid `url` and optional `tag`.
 */
function assertPagesArray(pages: unknown, source: string): asserts pages is unknown[] {
  if (!Array.isArray(pages)) {
    throw new Error(`${source}: "pages" must be an array of URLs or { url, tag? } objects`);
  }
}

export function validatePages(pages: unknown[], source: string): void {
  for (let i = 0; i < pages.length; i++) {
    const entry = pages[i] as PageConfigEntry;
    if (typeof entry === 'string') {
      try {
        new URL(entry);
      } catch {
        throw new Error(`${source}: pages[${i}] is not a valid URL: ${entry}`);
      }
    } else if (typeof entry === 'object' && entry !== null && typeof entry.url === 'string') {
      try {
        new URL(entry.url);
      } catch {
        throw new Error(`${source}: pages[${i}].url is not a valid URL: ${entry.url}`);
      }
      if (entry.tag !== undefined && typeof entry.tag !== 'string') {
        throw new Error(`${source}: pages[${i}].tag must be a string`);
      }
    } else {
      throw new Error(`${source}: pages[${i}] must be a URL string or { url, tag? } object`);
    }
  }
}

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
        if (parsed.pages) {
          assertPagesArray(parsed.pages, filepath);
          validatePages(parsed.pages, filepath);
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

/**
 * CLI-oriented config loader:
 * - If explicitPath is given, reads that file directly and throws if not found.
 * - Otherwise, auto-discovers by walking up from startDir (default: cwd).
 * - Returns null if no config file is found (instead of throwing).
 * - Does not require the "url" field — the CLI can supply it via argument.
 */
export async function findConfig(
  explicitPath?: string,
  startDir?: string,
): Promise<AgentDocsConfig | null> {
  if (explicitPath) {
    const filepath = resolve(process.cwd(), explicitPath);
    const content = await readFile(filepath, 'utf-8');
    const parsed = parseYaml(content) as AgentDocsConfig;
    if (parsed.pages) {
      assertPagesArray(parsed.pages, filepath);
      validatePages(parsed.pages, filepath);
    }
    return parsed;
  }

  let searchDir = resolve(startDir ?? process.cwd());
  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const filepath = resolve(searchDir, filename);
      try {
        const content = await readFile(filepath, 'utf-8');
        const parsed = parseYaml(content) as AgentDocsConfig;
        if (parsed.pages) {
          assertPagesArray(parsed.pages, filepath);
          validatePages(parsed.pages, filepath);
        }
        return parsed;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
    }
    const parent = dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }

  return null;
}
