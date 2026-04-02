# afdocs

[![CI](https://github.com/agent-ecosystem/afdocs/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-ecosystem/afdocs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/afdocs)](https://www.npmjs.com/package/afdocs)

Test your documentation site against the [Agent-Friendly Documentation Spec](https://agentdocsspec.com).

Agents don't use docs like humans. They hit truncation limits, get walls of CSS instead of content, can't follow cross-host redirects, and don't know about quality-of-life improvements like `llms.txt` or `.md` docs pages that would make life swell. Maybe this is because the industry has lacked guidance - until now.

afdocs runs 22 checks across 7 categories to evaluate how well your docs serve agent consumers.

> **Status: Early development (0.x)**
> This project is under active development. Check IDs, CLI flags, and output formats may change between minor versions. Feel free to try it out, but don't build automation against specific output until 1.0.
>
> Implements [spec v0.3.0](https://agentdocsspec.com/spec) (2026-03-31).

## Quick start

```bash
npx afdocs check https://docs.example.com
```

Example output:

```
Agent-Friendly Docs Check: https://react.dev

content-discoverability
  ✓ llms-txt-exists: llms.txt found at 1 location(s)
  ✓ llms-txt-valid: llms.txt follows the proposed structure
  ✓ llms-txt-size: llms.txt is 14,347 characters (under 50,000 threshold)
  ✓ llms-txt-links-resolve: All 50 tested links resolve (177 total links)
  ✓ llms-txt-links-markdown: 50/50 links point to markdown content (100%)

Markdown Availability
  ✗ content-negotiation: Server ignores Accept: text/markdown header (0/50 sampled pages return markdown)
  ✗ markdown-url-support: No sampled pages support .md URLs (0/50 tested)

URL Stability
  ✓ http-status-codes: All 50 sampled pages return proper error codes for bad URLs

Authentication
  ✓ auth-gate-detection: All 50 sampled pages are publicly accessible

Summary
  9 passed, 3 failed, 10 skipped (22 total)
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

# Scorecard with overall score, category scores, and fix suggestions
afdocs check https://docs.example.com --format scorecard

# Add fix suggestions to the standard text output
afdocs check https://docs.example.com --fixes

# JSON output with scoring data
afdocs check https://docs.example.com --format json --score

# Adjust thresholds
afdocs check https://docs.example.com --pass-threshold 30000 --fail-threshold 80000
```

### Options

| Option                  | Default  | Description                                           |
| ----------------------- | -------- | ----------------------------------------------------- |
| `--format <format>`     | `text`   | Output format: `text`, `json`, or `scorecard`         |
| `-v, --verbose`         |          | Show per-page details for checks with issues          |
| `--fixes`               |          | Show fix suggestions for warn/fail checks (text mode) |
| `--score`               |          | Include scoring data in JSON output                   |
| `--checks <ids>`        | all      | Comma-separated list of check IDs                     |
| `--sampling <strategy>` | `random` | URL sampling strategy (see below)                     |
| `--max-concurrency <n>` | `3`      | Maximum concurrent HTTP requests                      |
| `--request-delay <ms>`  | `200`    | Delay between requests                                |
| `--max-links <n>`       | `50`     | Maximum links to test in link checks                  |
| `--pass-threshold <n>`  | `50000`  | Size pass threshold (characters)                      |
| `--fail-threshold <n>`  | `100000` | Size fail threshold (characters)                      |

### Sampling strategies

By default, afdocs discovers pages from your site (via `llms.txt`, sitemap, or both) and randomly samples up to `--max-links` pages to check. The `--sampling` flag gives you control over how that sample is selected.

| Strategy        | Behavior                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `random`        | Shuffle discovered URLs and take the first N. Fast and broad, but results vary between runs.                                                                 |
| `deterministic` | Sort discovered URLs alphabetically, then pick every Nth URL for an even spread. Produces the same sample on repeated runs as long as the URL set is stable. |
| `none`          | Skip discovery entirely. Only check the URL you pass on the command line.                                                                                    |

```bash
# Reproducible runs for CI or iteration (same pages every time)
afdocs check https://docs.example.com --sampling deterministic

# Check a single page without any discovery
afdocs check https://docs.example.com/api/auth --sampling none

# Check a single page with specific checks
afdocs check https://docs.example.com/api/auth --sampling none --checks page-size-html,redirect-behavior
```

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

## Scoring

afdocs includes a scoring module that assigns a 0-100 numerical score to a documentation site's agent-friendliness. The score reflects how well agents can actually use the documentation, not just how many boxes are ticked: checks are weighted by impact, multi-page checks use proportional scoring (3/50 pages failing is different from 48/50), and interaction effects between checks are modeled as coefficients.

For a full explanation of how scores are calculated, including check weights, warn coefficients, score caps, and interaction diagnostics, see [How the Agent-Friendly Docs Score Works](SCORING.md).

### Scorecard output

`--format scorecard` renders the full scorecard: overall score with letter grade, per-category scores, interaction diagnostics (system-level findings that emerge from combinations of check results), and per-check results with fix suggestions.

```
Agent-Friendly Docs Scorecard
==============================

  Overall Score: 72 / 100 (C)

  Category Scores:
    Content Discoverability           72 / 100 (C)
    Markdown Availability             60 / 100 (C)
    Page Size and Truncation Risk     45 / 100 (D)
    ...

  Interaction Diagnostics:
    [!] Markdown support is undiscoverable
        Your site serves markdown at .md URLs, but agents have no way to
        discover this. ...

        Fix: Add a blockquote directive near the top of each docs page ...

  Check Results:
    Content Discoverability
      PASS  llms-txt-exists        llms.txt found at /llms.txt
      WARN  llms-txt-size          llms.txt is 65,000 characters
            Fix: If it grows further, split into nested llms.txt files ...
      FAIL  llms-txt-directive     No directive detected on any tested page
            Fix: Add a blockquote near the top of each page ...
```

### Letter grades

| Grade | Score | Description                                                                 |
| ----- | ----- | --------------------------------------------------------------------------- |
| A+    | 100   | Perfect. Every check passes.                                                |
| A     | 90-99 | Excellent. Agents can effectively navigate and consume this documentation.  |
| B     | 80-89 | Good. Minor improvements possible; agents can use most content.             |
| C     | 70-79 | Functional but with notable gaps. Some content is inaccessible or degraded. |
| D     | 60-69 | Significant barriers. Agents struggle to use this documentation.            |
| F     | 0-59  | Poor. Agents likely cannot use this documentation in a meaningful way.      |

### Programmatic scoring

The scoring module is available as a pure function for programmatic consumers:

```ts
import { computeScore } from 'afdocs';
// or import from the dedicated subpath:
// import { computeScore } from 'afdocs/scoring';

const report = await runChecks('https://docs.example.com');
const score = computeScore(report);

console.log(score.overall); // 72
console.log(score.grade); // 'C'
console.log(score.categoryScores); // { 'content-discoverability': { score: 80, grade: 'B' }, ... }
console.log(score.diagnostics); // [{ id: 'markdown-undiscoverable', severity: 'warning', ... }]
console.log(score.resolutions); // { 'llms-txt-directive': 'Add a blockquote near the top...' }
```

`computeScore` takes a `ReportResult` and returns a standalone `ScoreResult`. It does not modify the report. Composition is the consumer's responsibility: the CLI formatters compose them; external consumers call `computeScore()` directly.

## Test helpers

afdocs includes vitest helpers so you can add agent-friendliness checks to your docs site's CI pipeline. For a ready-to-copy setup with a GitHub Actions workflow, see the [`examples/`](examples/) directory.

### Setup

Install afdocs and vitest:

```bash
npm install -D afdocs vitest
```

Create `agent-docs.config.yml` in your project root (or a `tests/` subdirectory):

```yaml
url: https://docs.example.com
```

Create a test file:

```ts
import { describeAgentDocsPerCheck } from 'afdocs/helpers';

describeAgentDocsPerCheck();
```

Run it:

```bash
npx vitest run agent-docs.test.ts
```

Each check appears as its own test in the output, so you can see exactly what passed, warned, failed, or was skipped:

```
 ✓ Agent-Friendly Documentation > llms-txt-exists
 ✓ Agent-Friendly Documentation > llms-txt-valid
 ✓ Agent-Friendly Documentation > llms-txt-size
 × Agent-Friendly Documentation > markdown-url-support
 ↓ Agent-Friendly Documentation > page-size-markdown
```

Checks that fail cause the test to fail. Checks that warn still pass (they're informational). Checks skipped due to unmet dependencies or config filtering show as skipped.

### Running a subset of checks

If your platform doesn't support certain checks (for example, you can't serve markdown), you can limit which checks run via the config:

```yaml
url: https://docs.example.com
checks:
  - llms-txt-exists
  - llms-txt-valid
  - llms-txt-size
  - http-status-codes
  - auth-gate-detection
```

Only the listed checks will run. The rest show as skipped in the test output.

### Config resolution

The helpers look for `agent-docs.config.yml` (or `.yaml`) starting from `process.cwd()` and walking up the directory tree, so the config works whether your test file is at the project root or in a subdirectory. You can also pass an explicit directory:

```ts
describeAgentDocsPerCheck(__dirname);
```

### Timeouts

The helpers set a 120-second timeout on the check run automatically. No vitest timeout configuration is needed.

### Summary helper

If you don't need per-check granularity, `describeAgentDocs` provides a simpler two-test suite (one to run checks, one to assert no failures):

```ts
import { describeAgentDocs } from 'afdocs/helpers';

describeAgentDocs();
```

### Direct imports

For full control, use the programmatic API directly:

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

22 checks across 7 categories.

### Category 1: Content Discoverability

| Check                     | Description                                               |
| ------------------------- | --------------------------------------------------------- |
| `llms-txt-exists`         | Whether `llms.txt` is discoverable at candidate locations |
| `llms-txt-valid`          | Whether `llms.txt` follows the llmstxt.org structure      |
| `llms-txt-size`           | Whether `llms.txt` fits within agent truncation limits    |
| `llms-txt-links-resolve`  | Whether URLs in `llms.txt` return 200                     |
| `llms-txt-links-markdown` | Whether URLs in `llms.txt` point to markdown content      |
| `llms-txt-directive`      | Whether pages include a directive pointing to `llms.txt`  |

### Category 2: Markdown Availability

| Check                  | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `markdown-url-support` | Whether `.md` URL variants return markdown        |
| `content-negotiation`  | Whether the server honors `Accept: text/markdown` |

### Category 3: Page Size and Truncation Risk

| Check                    | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `rendering-strategy`     | Whether pages contain server-rendered content or are SPA shells |
| `page-size-markdown`     | Character count when served as markdown                         |
| `page-size-html`         | Character count of HTML and post-conversion size                |
| `content-start-position` | How far into the response actual content begins                 |

### Category 4: Content Structure

| Check                          | Description                                        |
| ------------------------------ | -------------------------------------------------- |
| `tabbed-content-serialization` | Whether tabbed content creates oversized output    |
| `section-header-quality`       | Whether headers in tabbed sections include context |
| `markdown-code-fence-validity` | Whether markdown has unclosed code fences          |

### Category 5: URL Stability and Redirects

| Check               | Description                                     |
| ------------------- | ----------------------------------------------- |
| `http-status-codes` | Whether error pages return correct status codes |
| `redirect-behavior` | Whether redirects are same-host HTTP redirects  |

### Category 6: Observability and Content Health

| Check                     | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `llms-txt-freshness`      | Whether `llms.txt` reflects current site state |
| `markdown-content-parity` | Whether markdown and HTML versions match       |
| `cache-header-hygiene`    | Whether cache headers allow timely updates     |

### Category 7: Authentication and Access

| Check                     | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `auth-gate-detection`     | Whether documentation pages require authentication to access content |
| `auth-alternative-access` | Whether auth-gated sites provide alternative access paths for agents |

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
