# Programmatic API

AFDocs exports its check runner and utilities as a TypeScript API, so you can integrate agent-friendliness checks into your own tools and workflows.

## Run all checks

```ts
import { runChecks } from 'afdocs';

const report = await runChecks('https://docs.example.com');

console.log(report.summary);
// { total: 22, pass: 15, warn: 3, fail: 2, skip: 2, error: 0 }

for (const result of report.results) {
  console.log(`${result.id}: ${result.status} — ${result.message}`);
}
```

`runChecks` returns a `ReportResult` containing:

- `url` — the URL that was checked
- `timestamp` — when the check ran
- `results` — array of `CheckResult` objects (one per check)
- `summary` — counts by status (pass, warn, fail, skip, error)
- `testedPages` — number of pages tested by page-level checks (present when page discovery ran)
- `samplingStrategy` — the sampling strategy used (`random`, `deterministic`, `curated`, or `none`)

## Run with options

Pass a second argument to configure sampling, concurrency, and thresholds:

```ts
import { runChecks } from 'afdocs';

// Run specific checks (include-list)
const report = await runChecks('https://docs.example.com', {
  checkIds: ['llms-txt-exists', 'llms-txt-valid', 'llms-txt-size'],
  samplingStrategy: 'deterministic',
  maxLinksToTest: 20,
  maxConcurrency: 5,
  requestDelay: 100,
  thresholds: {
    pass: 50000,
    fail: 100000,
  },
});

// Or run all checks except a few (exclude-list)
const skipReport = await runChecks('https://docs.example.com', {
  skipCheckIds: ['markdown-content-parity'],
});

// Or test specific pages with curated sampling
const curatedReport = await runChecks('https://docs.example.com', {
  samplingStrategy: 'curated',
  curatedPages: [
    'https://docs.example.com/quickstart',
    { url: 'https://docs.example.com/api/auth', tag: 'api-reference' },
  ],
});
```

All options are optional. The defaults match the CLI defaults.

## Run a single check

For more control, create a context and run individual checks:

```ts
import { createContext, getCheck } from 'afdocs';

const ctx = createContext('https://docs.example.com');
const check = getCheck('llms-txt-exists')!;
const result = await check.run(ctx);

console.log(result.status); // 'pass', 'warn', 'fail', or 'skip'
console.log(result.message);
```

`createContext` sets up the shared state (HTTP client, page cache, previous results) that checks use. If you run multiple checks against the same context, later checks can access the results of earlier ones through `ctx.previousResults`, which is how check dependencies work.

## List available checks

```ts
import { getAllChecks, getChecksSorted } from 'afdocs';

// All checks as a Map<string, CheckDefinition>
const all = getAllChecks();

// Checks in dependency-safe execution order
const sorted = getChecksSorted();
for (const check of sorted) {
  console.log(`${check.id} (${check.category}): ${check.description}`);
}
```

## Types

The main types you'll work with:

```ts
import type {
  CheckResult,
  CheckStatus, // 'pass' | 'warn' | 'fail' | 'skip' | 'error'
  ReportResult,
  RunnerOptions,
  CheckOptions,
  SamplingStrategy, // 'random' | 'deterministic' | 'curated' | 'none'
  AgentDocsConfig,
  CuratedPageEntry,
  PageConfigEntry,
} from 'afdocs';
```

See the [Scoring API](/reference/scoring-api) for scoring-related types.
