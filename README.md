# afdocs

[![CI](https://github.com/agent-ecosystem/afdocs/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-ecosystem/afdocs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/afdocs)](https://www.npmjs.com/package/afdocs)

Test your documentation site against the [Agent-Friendly Documentation Spec](https://agentdocsspec.com).

Agents don't use docs like humans. They hit truncation limits, get walls of CSS instead of content, can't follow cross-host redirects, and don't know about quality-of-life improvements like `llms.txt` or `.md` docs pages that would make life swell. Maybe this is because the industry has lacked guidance - until now.

afdocs runs 21 checks across 8 categories to evaluate how well your docs serve agent consumers. 10 are fully implemented; the rest return `skip` until completed.

> **Status: Early development (0.x)**
> This project is under active development. Check IDs, CLI flags, and output formats may change between minor versions. Feel free to try it out, but don't build automation against specific output until 1.0.
>
> Implements [spec v0.1.0](https://agentdocsspec.com/spec) (2026-02-22).

## Quick start

```bash
npx afdocs check https://docs.example.com
```

Example output:

```
Agent-Friendly Docs Check: https://react.dev

llms-txt
  ✓ llms-txt-exists: llms.txt found at 1 location(s)
  ✓ llms-txt-valid: llms.txt follows the proposed structure
  ✓ llms-txt-size: llms.txt is 14,347 characters (under 50,000 threshold)
  ✓ llms-txt-links-resolve: All 50 tested links resolve (177 total links)
  ✓ llms-txt-links-markdown: 50/50 links point to markdown content (100%)

Markdown Availability
  ✗ content-negotiation: Server ignores Accept: text/markdown header (0/50 sampled pages return markdown)
  ✗ markdown-url-support: No sampled pages support .md URLs (0/50 tested)

Summary
  5 passed, 2 failed, 14 skipped (21 total)
```

## Install

```bash
npm install afdocs
```

## CLI usage

```bash
# Run all checks
afdocs check https://docs.example.com

# Run specific checks
afdocs check https://docs.example.com --checks llms-txt-exists,llms-txt-valid,llms-txt-size

# JSON output
afdocs check https://docs.example.com --format json

# Adjust thresholds
afdocs check https://docs.example.com --pass-threshold 30000 --fail-threshold 80000
```

### Options

| Option                  | Default  | Description                                  |
| ----------------------- | -------- | -------------------------------------------- |
| `--format <format>`     | `text`   | Output format: `text` or `json`              |
| `-v, --verbose`         |          | Show per-page details for checks with issues |
| `--checks <ids>`        | all      | Comma-separated list of check IDs            |
| `--max-concurrency <n>` | `3`      | Maximum concurrent HTTP requests             |
| `--request-delay <ms>`  | `200`    | Delay between requests                       |
| `--max-links <n>`       | `50`     | Maximum links to test in link checks         |
| `--pass-threshold <n>`  | `50000`  | Size pass threshold (characters)             |
| `--fail-threshold <n>`  | `100000` | Size fail threshold (characters)             |

### Exit codes

- `0` if all checks pass or warn
- `1` if any check fails

## Programmatic API

```ts
import { runChecks, createContext, getCheck } from 'afdocs';

// Run all checks
const report = await runChecks('https://docs.example.com');

// Run a single check
const ctx = createContext('https://docs.example.com');
const check = getCheck('llms-txt-exists')!;
const result = await check.run(ctx);
```

## Test helpers

afdocs includes vitest helpers so you can add agent-friendliness checks to your docs site's test suite.

### Config-driven

Create `agent-docs.config.yml`:

```yaml
url: https://docs.example.com
checks:
  - llms-txt-exists
  - llms-txt-valid
  - llms-txt-size
```

Then in your test file:

```ts
import { describeAgentDocs } from 'afdocs/helpers';

describeAgentDocs();
```

This reads the config and generates one test assertion covering all specified checks.

### Direct imports

```ts
import { createContext, getCheck } from 'afdocs';
import { describe, it, expect } from 'vitest';

describe('agent-friendliness', () => {
  it('has a valid llms.txt', async () => {
    const ctx = createContext('https://docs.example.com');
    const check = getCheck('llms-txt-exists')!;
    const result = await check.run(ctx);
    expect(result.status).toBe('pass');
  });
});
```

## Checks

21 checks across 8 categories. Checks marked with \* are stub implementations that return `skip`.

### Category 1: llms.txt

| Check                     | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `llms-txt-exists`         | Whether `llms.txt` is discoverable at candidate locations |
| `llms-txt-valid`          | Whether `llms.txt` follows the llmstxt.org structure      |
| `llms-txt-size`           | Whether `llms.txt` fits within agent truncation limits    |
| `llms-txt-links-resolve`  | Whether URLs in `llms.txt` return 200                     |
| `llms-txt-links-markdown` | Whether URLs in `llms.txt` point to markdown content      |

### Category 2: Markdown Availability

| Check                  | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `markdown-url-support` | Whether `.md` URL variants return markdown        |
| `content-negotiation`  | Whether the server honors `Accept: text/markdown` |

### Category 3: Page Size and Truncation Risk

| Check                    | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `page-size-markdown`     | Character count when served as markdown          |
| `page-size-html`         | Character count of HTML and post-conversion size |
| `content-start-position` | How far into the response actual content begins  |

### Category 4: Content Structure

| Check                             | Description                                        |
| --------------------------------- | -------------------------------------------------- |
| `tabbed-content-serialization` \* | Whether tabbed content creates oversized output    |
| `section-header-quality` \*       | Whether headers in tabbed sections include context |
| `markdown-code-fence-validity` \* | Whether markdown has unclosed code fences          |

### Category 5: URL Stability and Redirects

| Check                  | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `http-status-codes` \* | Whether error pages return correct status codes |
| `redirect-behavior` \* | Whether redirects are same-host HTTP redirects  |

### Category 6: Agent Discoverability Directives

| Check                   | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `llms-txt-directive` \* | Whether pages include a directive pointing to `llms.txt` |

### Category 7: Observability and Content Health

| Check                        | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `llms-txt-freshness` \*      | Whether `llms.txt` reflects current site state |
| `markdown-content-parity` \* | Whether markdown and HTML versions match       |
| `cache-header-hygiene` \*    | Whether cache headers allow timely updates     |

### Category 8: Authentication and Access

| Check                        | Description                                                          |
| ---------------------------- | -------------------------------------------------------------------- |
| `auth-gate-detection` \*     | Whether documentation pages require authentication to access content |
| `auth-alternative-access` \* | Whether auth-gated sites provide alternative access paths for agents |

## Check dependencies

Some checks depend on others. If a dependency doesn't pass, the dependent check is skipped automatically.

- `llms-txt-valid`, `llms-txt-size`, `llms-txt-links-resolve`, `llms-txt-links-markdown` require `llms-txt-exists`
- `page-size-markdown` requires `markdown-url-support` or `content-negotiation`
- `section-header-quality` requires `tabbed-content-serialization`
- `markdown-code-fence-validity` requires `markdown-url-support` or `content-negotiation`
- `llms-txt-freshness` requires `llms-txt-exists`
- `markdown-content-parity` requires `markdown-url-support` or `content-negotiation`
- `auth-alternative-access` requires `auth-gate-detection` (warn or fail)

## Responsible use

afdocs makes HTTP requests to the sites it checks. It enforces delays between requests (200ms default), caps concurrent connections, and honors `Retry-After` headers. The goal is to help documentation teams improve agent accessibility, not to load-test their infrastructure.

## License

MIT
