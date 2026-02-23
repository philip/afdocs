import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { runChecks } from '../../src/runner.js';
import '../../src/checks/index.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('runner', () => {
  it('skips dependent checks when dependency fails', async () => {
    server.use(
      http.get('http://nodeps.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get('http://nodeps.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://nodeps.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid', 'llms-txt-size'],
      requestDelay: 0,
    });

    expect(report.results[0].id).toBe('llms-txt-exists');
    expect(report.results[0].status).toBe('fail');

    // Dependent checks should be skipped
    expect(report.results[1].id).toBe('llms-txt-valid');
    expect(report.results[1].status).toBe('skip');
    expect(report.results[2].id).toBe('llms-txt-size');
    expect(report.results[2].status).toBe('skip');
  });

  it('runs dependent checks when dependency passes', async () => {
    const content = `# Test\n\n> Summary.\n\n## Links\n\n- [A](http://deps.local/a): A\n`;
    server.use(
      http.get('http://deps.local/llms.txt', () => HttpResponse.text(content)),
      http.get('http://deps.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://deps.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid', 'llms-txt-size'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('pass');
    expect(report.results[1].status).toBe('pass');
    expect(report.results[2].status).toBe('pass');
  });

  it('produces correct summary counts', async () => {
    server.use(
      http.get('http://summary.local/llms.txt', () => new HttpResponse(null, { status: 404 })),
      http.get('http://summary.local/docs/llms.txt', () => new HttpResponse(null, { status: 404 })),
    );

    const report = await runChecks('http://summary.local', {
      checkIds: ['llms-txt-exists', 'llms-txt-valid'],
      requestDelay: 0,
    });

    expect(report.summary.fail).toBe(1);
    expect(report.summary.skip).toBe(1);
    expect(report.summary.total).toBe(2);
  });

  it('stub checks return skip with "Not yet implemented"', async () => {
    const report = await runChecks('http://stub.local', {
      checkIds: ['auth-gate-detection'],
      requestDelay: 0,
    });

    expect(report.results[0].status).toBe('skip');
    expect(report.results[0].message).toBe('Not yet implemented');
  });
});
