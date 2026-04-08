import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, findConfig } from '../../../src/helpers/config.js';

const TMP_DIR = resolve(import.meta.dirname, '../../fixtures/config-test');

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads agent-docs.config.yml', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(resolve(TMP_DIR, 'agent-docs.config.yml'), 'url: https://example.com\n');

    const config = await loadConfig(TMP_DIR);
    expect(config.url).toBe('https://example.com');
  });

  it('loads agent-docs.config.yaml', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(
      resolve(TMP_DIR, 'agent-docs.config.yaml'),
      'url: https://example.com\nchecks:\n  - llms-txt-exists\n',
    );

    const config = await loadConfig(TMP_DIR);
    expect(config.url).toBe('https://example.com');
    expect(config.checks).toEqual(['llms-txt-exists']);
  });

  it('prefers .yml over .yaml', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(resolve(TMP_DIR, 'agent-docs.config.yml'), 'url: https://yml.example.com\n');
    await writeFile(resolve(TMP_DIR, 'agent-docs.config.yaml'), 'url: https://yaml.example.com\n');

    const config = await loadConfig(TMP_DIR);
    expect(config.url).toBe('https://yml.example.com');
  });

  it('throws when no config file found', async () => {
    await mkdir(TMP_DIR, { recursive: true });

    await expect(loadConfig(TMP_DIR)).rejects.toThrow('No agent-docs config file found');
  });

  it('throws when config is missing url field', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(resolve(TMP_DIR, 'agent-docs.config.yml'), 'checks:\n  - llms-txt-exists\n');

    await expect(loadConfig(TMP_DIR)).rejects.toThrow('missing required "url" field');
  });

  it('walks up directories to find config', async () => {
    const parentDir = TMP_DIR;
    const childDir = resolve(TMP_DIR, 'sub/nested');
    await mkdir(childDir, { recursive: true });
    await writeFile(
      resolve(parentDir, 'agent-docs.config.yml'),
      'url: https://parent.example.com\n',
    );

    const config = await loadConfig(childDir);
    expect(config.url).toBe('https://parent.example.com');
  });

  it('finds config in immediate dir before walking up', async () => {
    const parentDir = TMP_DIR;
    const childDir = resolve(TMP_DIR, 'sub');
    await mkdir(childDir, { recursive: true });
    await writeFile(
      resolve(parentDir, 'agent-docs.config.yml'),
      'url: https://parent.example.com\n',
    );
    await writeFile(resolve(childDir, 'agent-docs.config.yml'), 'url: https://child.example.com\n');

    const config = await loadConfig(childDir);
    expect(config.url).toBe('https://child.example.com');
  });
});

describe('findConfig', () => {
  it('returns null when no config file found', async () => {
    await mkdir(TMP_DIR, { recursive: true });

    const result = await findConfig(undefined, TMP_DIR);
    expect(result).toBeNull();
  });

  it('loads config from an explicit path', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'custom.yml');
    await writeFile(configPath, 'url: https://custom.example.com\nchecks:\n  - llms-txt-exists\n');

    const config = await findConfig(configPath);
    expect(config?.url).toBe('https://custom.example.com');
    expect(config?.checks).toEqual(['llms-txt-exists']);
  });

  it('throws when explicit path does not exist', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const missing = resolve(TMP_DIR, 'nonexistent.yml');

    await expect(findConfig(missing)).rejects.toThrow();
  });

  it('does not require the url field', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'no-url.yml');
    await writeFile(configPath, 'checks:\n  - llms-txt-exists\n');

    const config = await findConfig(configPath);
    expect(config?.checks).toEqual(['llms-txt-exists']);
    expect(config?.url).toBeUndefined();
  });

  it('loads options from explicit path', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'with-options.yml');
    await writeFile(
      configPath,
      'url: https://example.com\noptions:\n  samplingStrategy: deterministic\n  maxLinksToTest: 10\n',
    );

    const config = await findConfig(configPath);
    expect(config?.options?.samplingStrategy).toBe('deterministic');
    expect(config?.options?.maxLinksToTest).toBe(10);
  });

  it('walks up directories to find config', async () => {
    const childDir = resolve(TMP_DIR, 'sub/nested');
    await mkdir(childDir, { recursive: true });
    await writeFile(resolve(TMP_DIR, 'agent-docs.config.yml'), 'url: https://parent.example.com\n');

    const config = await findConfig(undefined, childDir);
    expect(config?.url).toBe('https://parent.example.com');
  });

  it('prefers .yml over .yaml', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(resolve(TMP_DIR, 'agent-docs.config.yml'), 'url: https://yml.example.com\n');
    await writeFile(resolve(TMP_DIR, 'agent-docs.config.yaml'), 'url: https://yaml.example.com\n');

    const config = await findConfig(undefined, TMP_DIR);
    expect(config?.url).toBe('https://yml.example.com');
  });

  it('loads pages as string array', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'with-pages.yml');
    await writeFile(
      configPath,
      'url: https://example.com\npages:\n  - https://example.com/a\n  - https://example.com/b\n',
    );

    const config = await findConfig(configPath);
    expect(config?.pages).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('loads pages as mixed string and object array', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'mixed-pages.yml');
    await writeFile(
      configPath,
      [
        'url: https://example.com',
        'pages:',
        '  - https://example.com/a',
        '  - url: https://example.com/b',
        '    tag: api',
        '',
      ].join('\n'),
    );

    const config = await findConfig(configPath);
    expect(config?.pages).toHaveLength(2);
    expect(config?.pages?.[0]).toBe('https://example.com/a');
    expect(config?.pages?.[1]).toEqual({ url: 'https://example.com/b', tag: 'api' });
  });

  it('throws on invalid URL in pages', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'bad-pages.yml');
    await writeFile(configPath, 'url: https://example.com\npages:\n  - not-a-url\n');

    await expect(findConfig(configPath)).rejects.toThrow('pages[0] is not a valid URL');
  });

  it('throws on invalid object entry in pages', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'bad-obj.yml');
    await writeFile(configPath, 'url: https://example.com\npages:\n  - foo: bar\n');

    await expect(findConfig(configPath)).rejects.toThrow('pages[0] must be a URL string or');
  });

  it('throws when pages is a scalar instead of an array', async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const configPath = resolve(TMP_DIR, 'scalar-pages.yml');
    await writeFile(configPath, 'url: https://example.com\npages: https://example.com/a\n');

    await expect(findConfig(configPath)).rejects.toThrow('"pages" must be an array');
  });
});
