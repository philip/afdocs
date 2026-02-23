# Development

Guide for contributors working on afdocs.

## Prerequisites

- Node.js >= 22 (CI tests against 22 and 24)
- npm

## Setup

```bash
git clone https://github.com/agent-ecosystem/afdocs.git
cd afdocs
npm install
```

Husky installs automatically via the `prepare` script and will run lint-staged on pre-commit (Prettier + ESLint on staged files).

## Commands

| Command                 | Description                              |
| ----------------------- | ---------------------------------------- |
| `npm test`              | Run all tests once                       |
| `npm run test:watch`    | Run tests in watch mode                  |
| `npm run test:coverage` | Run tests with coverage report           |
| `npm run build`         | Compile TypeScript to `dist/`            |
| `npm run lint`          | ESLint + `tsc --noEmit` type checking    |
| `npm run format`        | Format all files with Prettier           |
| `npm run format:check`  | Check formatting without writing changes |

## Building and running locally

Build the TypeScript source to `dist/`:

```bash
npm run build
```

Then run the CLI from the repo:

```bash
node bin/afdocs.mjs check https://docs.example.com
```

Or link it globally so you can use `afdocs` as a command:

```bash
npm link
afdocs check https://docs.example.com
```

The build step is required after any source change. The CLI entry point (`bin/afdocs.mjs`) imports from `dist/`, not `src/`, so stale builds will give you stale behavior.

A typical edit-test cycle looks like:

```bash
# Edit source files in src/
npm run build && node bin/afdocs.mjs check https://docs.example.com
```

For running specific checks or changing output format, see the CLI options in the README.

## Project structure

```
src/
  checks/          # Check implementations, grouped by category
    registry.ts    # Check registration and lookup
    index.ts       # Side-effect imports that register all checks
  cli/             # CLI entry point and formatters
  helpers/         # Shared utilities (HTTP, markdown detection, etc.)
  runner.ts        # Orchestrates check execution with dependency resolution
  types.ts         # Shared type definitions
  http.ts          # Rate-limited HTTP client
test/
  unit/            # Unit tests (mocked HTTP via MSW)
  integration/     # Integration tests (spawns the CLI binary)
  fixtures/        # Shared test fixtures
bin/
  afdocs.mjs       # CLI binary entry point
```

## Writing checks

Each check lives in `src/checks/<category>/<check-id>.ts` and self-registers via `registerCheck()`. The runner resolves dependencies automatically, so checks can declare what they depend on and access prior results through `ctx.previousResults`.

A check module exports nothing directly. Instead it calls `registerCheck()` as a side effect, and `src/checks/index.ts` imports every check module so they all register at startup.

Pattern for a new check:

```ts
import { registerCheck } from '../registry.js';
import type { CheckContext, CheckResult } from '../../types.js';

async function check(ctx: CheckContext): Promise<CheckResult> {
  // Implementation here
  return { id: 'my-check', category: 'my-category', status: 'pass', message: '...' };
}

registerCheck({
  id: 'my-check',
  category: 'my-category',
  description: 'What this check measures',
  dependsOn: [], // OR-groups: [['dep-a', 'dep-b']] means either must pass
  run: check,
});
```

After creating the file, add an import to `src/checks/index.ts`.

### Page discovery and sampling

Several checks need to discover page URLs, then sample a subset for testing. Use the `discoverAndSamplePages` helper from `src/helpers/get-page-urls.ts` rather than inlining this logic:

```ts
import { discoverAndSamplePages } from '../../helpers/get-page-urls.js';

const {
  urls: pageUrls,
  totalPages,
  sampled: wasSampled,
  warnings,
} = await discoverAndSamplePages(ctx);
```

This handles the full discovery chain (llms.txt links, sitemap, baseUrl fallback) and Fisher-Yates shuffles down to `maxLinksToTest` when needed.

### Check dependencies and standalone mode

Checks can declare dependencies via `dependsOn`. The runner resolves these so that, for example, `page-size-markdown` can read cached markdown from `markdown-url-support` and `content-negotiation`.

When a user runs a single check with `--checks`, its dependencies may not have executed. Checks that rely on `ctx.previousResults` or `ctx.pageCache` should handle this gracefully:

1. **Check whether dependencies ran.** Look for the result in `ctx.previousResults`:

   ```ts
   const depResult = ctx.previousResults.get('some-dependency');
   if (depResult) {
     // Use cached data from the dependency
   } else {
     // Standalone mode: fetch data yourself
   }
   ```

2. **Reproduce the discovery logic independently.** The `getPageUrls` helper already handles this for page URL discovery. When `llms-txt-exists` hasn't run, it fetches llms.txt directly rather than reading from previous results. If your check needs other data that a dependency normally provides, add a similar direct-fetch fallback.

3. **Ensure parity.** A standalone check should produce the same results as when it runs as part of the full suite. If standalone mode discovers pages differently (fewer URLs, different sources), users will see inconsistent results depending on which checks they run.

See `page-size-markdown.ts` for a concrete example: it reads from `ctx.pageCache` when dependencies ran, and falls back to `discoverAndSamplePages` with its own markdown fetching when they didn't.

### Testing checks with dependencies

When writing tests for checks that call `getPageUrls` or `discoverAndSamplePages`, set `llms-txt-exists` in `ctx.previousResults` to avoid unintended network requests. If `llms-txt-exists` isn't in the map, the helper will try to fetch llms.txt directly, which causes 10-second timeouts against unmocked hosts.

For tests that provide llms.txt content:

```ts
ctx.previousResults.set('llms-txt-exists', {
  id: 'llms-txt-exists',
  category: 'llms-txt',
  status: 'pass',
  message: 'Found',
  details: { discoveredFiles: [{ url: '...', content: '...', status: 200, redirected: false }] },
});
```

For tests that don't need llms.txt (e.g. testing sitemap fallback):

```ts
ctx.previousResults.set('llms-txt-exists', {
  id: 'llms-txt-exists',
  category: 'llms-txt',
  status: 'fail',
  message: 'No llms.txt found',
  details: { discoveredFiles: [] },
});
```

For tests that specifically exercise standalone mode (no `previousResults` at all), mock the llms.txt endpoints to return 404:

```ts
server.use(
  http.get('http://example.local/llms.txt', () => new HttpResponse('Not found', { status: 404 })),
  http.get(
    'http://example.local/docs/llms.txt',
    () => new HttpResponse('Not found', { status: 404 }),
  ),
);
```

## Testing

Tests use [Vitest](https://vitest.dev/) with [MSW](https://mswjs.io/) (Mock Service Worker) for HTTP mocking. The typical pattern:

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  return () => server.close();
});

it('does the thing', async () => {
  server.use(
    http.get(
      'http://test.local/page',
      () =>
        new HttpResponse('<html>...</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    ),
  );

  const ctx = createContext('http://test.local', { requestDelay: 0 });
  const check = getCheck('my-check')!;
  const result = await check.run(ctx);
  expect(result.status).toBe('pass');
});
```

Use unique hostnames per test (e.g. `http://my-check-pass.local/...`) to avoid MSW handler collisions between tests.

Set `requestDelay: 0` in test contexts to avoid artificial delays.

## Known issues

### Node.js 25 localStorage warning

When running tests on Node.js 25, MSW's internal `cookieStore` module accesses the experimental `localStorage` global at import time. This triggers the warning:

```
Warning: `--localstorage-file` was provided without a valid path
```

This is a known issue between Node.js 25's WebStorage API and MSW's `cookieStore` module (see [vitest-dev/vitest#8757](https://github.com/vitest-dev/vitest/issues/8757), [mswjs/msw#2612](https://github.com/mswjs/msw/issues/2612)). The warning is cosmetic and does not affect test behavior; afdocs does not use `localStorage`. To suppress it locally:

```bash
NODE_OPTIONS='--no-experimental-webstorage' npm test
```

The `--no-experimental-webstorage` flag only exists in Node 25+, so it is not set in the npm scripts (which need to work on Node 22 and 24 as well). This workaround can be removed once MSW or Node.js resolves the incompatibility.

## Code style

- Prettier handles formatting (config in `.prettierrc.json`): single quotes, trailing commas, 100-char line width
- ESLint with typescript-eslint for linting (flat config in `eslint.config.js`)
- Unused variables prefixed with `_` are allowed
- Pre-commit hooks enforce formatting and linting automatically

## CI

GitHub Actions runs on every push to `main` and on pull requests. The pipeline lints, checks formatting, runs tests, and builds. See `.github/workflows/ci.yml`.
