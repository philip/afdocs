import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const VALID_LLMS_TXT = `# Test

> Summary.

## Links

- [A](http://cmd-test.local/a): A
`;

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('check command', () => {
  it('runs via CLI entry point with text format', async () => {
    server.use(
      http.get('http://cmd-test.local/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get(
        'http://cmd-test.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { run } = await import('../../../src/cli/index.js');
    await run([
      'node',
      'afdocs',
      'check',
      'http://cmd-test.local',
      '--checks',
      'llms-txt-exists',
      '--request-delay',
      '0',
    ]);

    // Commander actions are async; give it a tick
    await new Promise((r) => setTimeout(r, 100));

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('llms-txt-exists');
    expect(output).toContain('pass');

    writeSpy.mockRestore();
  });

  it('runs with json format', async () => {
    server.use(
      http.get('http://cmd-json.local/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get(
        'http://cmd-json.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { run } = await import('../../../src/cli/index.js');
    await run([
      'node',
      'afdocs',
      'check',
      'http://cmd-json.local',
      '--checks',
      'llms-txt-exists',
      '--format',
      'json',
      '--request-delay',
      '0',
    ]);

    await new Promise((r) => setTimeout(r, 100));

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output.trim());
    expect(parsed.url).toBe('http://cmd-json.local');
    expect(parsed.results[0].id).toBe('llms-txt-exists');

    writeSpy.mockRestore();
  });

  it('sets exit code 1 on failure', async () => {
    server.use(
      http.get('http://cmd-fail.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get(
        'http://cmd-fail.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { run } = await import('../../../src/cli/index.js');
    await run([
      'node',
      'afdocs',
      'check',
      'http://cmd-fail.local',
      '--checks',
      'llms-txt-exists',
      '--request-delay',
      '0',
    ]);

    await new Promise((r) => setTimeout(r, 100));

    expect(process.exitCode).toBe(1);

    writeSpy.mockRestore();
  });

  it('does not set exit code 1 when all pass', async () => {
    server.use(
      http.get('http://cmd-pass.local/llms.txt', () => HttpResponse.text(VALID_LLMS_TXT)),
      http.get(
        'http://cmd-pass.local/docs/llms.txt',
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { run } = await import('../../../src/cli/index.js');
    await run([
      'node',
      'afdocs',
      'check',
      'http://cmd-pass.local',
      '--checks',
      'llms-txt-exists',
      '--request-delay',
      '0',
    ]);

    await new Promise((r) => setTimeout(r, 100));

    expect(process.exitCode).toBeUndefined();

    writeSpy.mockRestore();
  });
});
