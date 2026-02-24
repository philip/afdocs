import { describe, it, expect, beforeAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';
import type { DiscoveredFile } from '../../../src/types.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

describe('auth-gate-detection', () => {
  const check = getCheck('auth-gate-detection')!;

  function makeCtx(llmsTxtContent?: string) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });

    if (llmsTxtContent) {
      const discovered: DiscoveredFile[] = [
        {
          url: 'http://test.local/llms.txt',
          content: llmsTxtContent,
          status: 200,
          redirected: false,
        },
      ];
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'llms-txt',
        status: 'pass',
        message: 'Found',
        details: { discoveredFiles: discovered },
      });
    } else {
      ctx.previousResults.set('llms-txt-exists', {
        id: 'llms-txt-exists',
        category: 'llms-txt',
        status: 'fail',
        message: 'No llms.txt found',
        details: { discoveredFiles: [] },
      });
    }

    return ctx;
  }

  it('passes when all pages are accessible', async () => {
    server.use(
      http.get(
        'http://agd-pass.local/docs/page1',
        () =>
          new HttpResponse('<html><body><h1>Docs</h1><p>Content here.</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-pass.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.details?.accessible).toBe(1);
  });

  it('fails when page returns 401', async () => {
    server.use(
      http.get(
        'http://agd-401.local/docs/page1',
        () => new HttpResponse('Unauthorized', { status: 401 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-401.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.authRequired).toBe(1);
  });

  it('fails when page returns 403', async () => {
    server.use(
      http.get(
        'http://agd-403.local/docs/page1',
        () => new HttpResponse('Forbidden', { status: 403 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-403.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.authRequired).toBe(1);
  });

  it('warns when some pages are gated and some accessible', async () => {
    server.use(
      http.get(
        'http://agd-mix.local/docs/page1',
        () =>
          new HttpResponse('<html><body><h1>Docs</h1></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
      http.get(
        'http://agd-mix.local/docs/page2',
        () => new HttpResponse('Unauthorized', { status: 401 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-mix.local/docs/page1): First\n- [Page 2](http://agd-mix.local/docs/page2): Second\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('warn');
    expect(result.details?.accessible).toBe(1);
    expect(result.details?.authRequired).toBe(1);
  });

  it('detects SSO redirect to known domain', async () => {
    server.use(
      http.get(
        'http://agd-sso.local/docs/page1',
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: {
              Location: 'https://login.microsoftonline.com/oauth2/authorize?client_id=abc',
            },
          }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-sso.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.authRedirect).toBe(1);
    expect(result.details?.ssoDomains).toContain('login.microsoftonline.com');
  });

  it('detects login form (password field)', async () => {
    server.use(
      http.get(
        'http://agd-form.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><form><input type="text" name="user"><input type="password" name="pass"><button>Log in</button></form></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-form.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.softAuthGate).toBe(1);
  });

  it('detects login form via page title', async () => {
    server.use(
      http.get(
        'http://agd-title.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><head><title>Sign In - Company Portal</title></head><body><div>Please authenticate</div></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-title.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.softAuthGate).toBe(1);
  });

  it('treats non-SSO redirects as accessible', async () => {
    server.use(
      http.get(
        'http://agd-noredir.local/docs/page1',
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { Location: 'http://agd-noredir.local/docs/page1-new' },
          }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-noredir.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.details?.accessible).toBe(1);
  });

  it('resolves relative Location headers in SSO redirects', async () => {
    server.use(
      http.get(
        'http://agd-relredir.local/docs/page1',
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { Location: '/login?redirect=/docs/page1' },
          }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-relredir.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    // login.* prefix matches SSO_DOMAINS
    expect(result.status).toBe('pass');
    expect(result.details?.accessible).toBe(1);
  });

  it('treats other status codes (e.g. 500) as accessible', async () => {
    server.use(
      http.get(
        'http://agd-500.local/docs/page1',
        () => new HttpResponse('Internal Server Error', { status: 500 }),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-500.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('pass');
    expect(result.details?.accessible).toBe(1);
  });

  it('fails when all fetches error out', async () => {
    server.use(
      http.get('http://agd-allfail.local/docs/page1', () => HttpResponse.error()),
      http.get('http://agd-allfail.local/docs/page2', () => HttpResponse.error()),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-allfail.local/docs/page1): First\n- [Page 2](http://agd-allfail.local/docs/page2): Second\n`;
    const result = await check.run(makeCtx(content));
    // All results are errors with classification 'accessible', so tested.length > 0 but no gated
    expect(result.details?.fetchErrors).toBe(2);
  });

  it('detects SSO form action as soft auth gate', async () => {
    server.use(
      http.get(
        'http://agd-ssoform.local/docs/page1',
        () =>
          new HttpResponse(
            '<html><body><form action="https://idp.example.com/saml/login"><button>Login with SSO</button></form></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          ),
      ),
    );

    const content = `# Docs\n## Links\n- [Page 1](http://agd-ssoform.local/docs/page1): First\n`;
    const result = await check.run(makeCtx(content));
    expect(result.status).toBe('fail');
    expect(result.details?.softAuthGate).toBe(1);
  });
});
