# Scoring API

The scoring module is available as a pure function for programmatic consumers. It takes a `ReportResult` from `runChecks` and returns a standalone `ScoreResult` with the overall score, per-category breakdowns, interaction diagnostics, and fix suggestions.

## Compute a score

```ts
import { runChecks, computeScore } from 'afdocs';

const report = await runChecks('https://docs.example.com');
const score = computeScore(report);

console.log(score.overall); // 72
console.log(score.grade); // 'C'
console.log(score.categoryScores); // { 'content-discoverability': { score: 80, grade: 'B' }, ... }
console.log(score.diagnostics); // [{ id: 'markdown-undiscoverable', severity: 'warning', ... }]
console.log(score.resolutions); // { 'llms-txt-directive': 'Add a blockquote near the top...' }
```

`computeScore` is a pure function. It does not modify the report or make any network requests. Composition is the consumer's responsibility: the CLI formatters compose `runChecks` and `computeScore`; external consumers call them separately.

## Import from the subpath

You can also import from the dedicated scoring subpath:

```ts
import { computeScore } from 'afdocs/scoring';
```

This is the same function; the subpath is provided for consumers who want a narrower import.

## ScoreResult

`computeScore` returns a `ScoreResult` with these fields:

| Field            | Type                            | Description                                                               |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `overall`        | `number`                        | The overall score (0-100)                                                 |
| `grade`          | `Grade`                         | Letter grade (`A+`, `A`, `B`, `C`, `D`, `F`)                              |
| `categoryScores` | `Record<string, CategoryScore>` | Per-category score and grade                                              |
| `checkScores`    | `Record<string, CheckScore>`    | Per-check scoring details (weight, coefficient, proportion, earned score) |
| `diagnostics`    | `Diagnostic[]`                  | Interaction diagnostics that fired                                        |
| `caps`           | `ScoreCap[]`                    | Score caps that were applied                                              |
| `resolutions`    | `Record<string, string>`        | Fix suggestions keyed by check ID                                         |

## Grade conversion

If you need to convert a numeric score to a letter grade independently:

```ts
import { toGrade } from 'afdocs';

toGrade(92); // 'A'
toGrade(100); // 'A+'
toGrade(55); // 'F'
```

## Types

```ts
import type {
  ScoreResult,
  CheckScore,
  CategoryScore,
  ScoreCap,
  Diagnostic,
  DiagnosticSeverity, // 'info' | 'warning' | 'critical'
  Grade, // 'A+' | 'A' | 'B' | 'C' | 'D' | 'F'
} from 'afdocs';
```

For how the score is calculated (weights, coefficients, caps, proportional scoring), see [Score Calculation](/agent-score-calculation).
