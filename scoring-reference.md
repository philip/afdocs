# Scoring Implementation Reference: Agent-Friendly Docs Scorecard

Scoring Version: 0.1.0
Agent-Friendly Docs Spec Version: v0.3.0
Spec URL: https://agentdocsspec.com
Date: 03/31/2026

## Goals

1. Assign a 0-100 numerical score to a documentation site's agent-friendliness.
2. Surface **interaction diagnostics**: system-level failures that emerge from
   combinations of check results and aren't visible from individual checks alone.

## Design Principles

- The score should reflect how well agents can actually use the documentation,
  not just how many boxes are ticked. A site with perfect markdown support that
  no agent can discover should score lower than a site with imperfect markdown
  support that agents are directed to.
- Proportional scoring for multi-page checks: 3/50 pages failing is different
  from 48/50 pages failing. The existing `details` fields already contain
  per-page breakdowns; the scoring layer reads those rather than relying on
  the aggregated top-level status.
- Skipped checks (due to failed dependencies) score 0 and are excluded from
  the denominator. The dependency failure already carries the penalty.
- The scoring module does not change check results. It is a read-only consumer
  of `ReportResult`.

---

## Weight Tiers

Each check is assigned to a tier based on its observed impact on agent
workflows. Tier assignments are derived from the spec's "Start Here" ordering
and the empirical evidence sections in each check definition.

| Tier         | Base weight | Criteria                                                                                                   |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| **Critical** | 10          | Agents cannot function without this. Failure means zero content, zero navigation, or zero access.          |
| **High**     | 7           | Directly limits agent effectiveness. Failure means truncation, dead ends, or agents stuck on a worse path. |
| **Medium**   | 4           | Significant but not blocking. Failure degrades quality or misses an opportunity.                           |
| **Low**      | 2           | Refinements. Failure is a missed best practice, not an agent-blocking issue.                               |

### Per-Check Weights

| Check ID                       | Tier     | Weight | Rationale                                                                                                                                             |
| ------------------------------ | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llms-txt-exists`              | Critical | 10     | Single highest-impact action per spec. Primary navigation mechanism for agents.                                                                       |
| `rendering-strategy`           | Critical | 10     | SPA shell = zero content. Not a truncation problem; a no-content problem.                                                                             |
| `auth-gate-detection`          | Critical | 10     | Auth-gated docs are completely opaque to agents.                                                                                                      |
| `llms-txt-size`                | High     | 7      | Truncated index defeats the purpose of llms.txt.                                                                                                      |
| `llms-txt-links-resolve`       | High     | 7      | Broken links in llms.txt send agents down dead ends with high confidence.                                                                             |
| `llms-txt-links-markdown`      | High     | 7      | Agents work significantly less effectively with HTML content. Pointing to markdown directly is the difference between a good and degraded experience. |
| `markdown-url-support`         | High     | 7      | Core format capability. Markdown is what agents actually want.                                                                                        |
| `page-size-markdown`           | High     | 7      | Direct truncation risk on the best-case content path.                                                                                                 |
| `page-size-html`               | High     | 7      | Affects the majority of agents, which receive HTML.                                                                                                   |
| `http-status-codes`            | High     | 7      | Soft 404s actively mislead agents into extracting info from error pages.                                                                              |
| `llms-txt-directive`           | High     | 7      | Discoverability multiplier. Amplifies value of llms.txt and markdown support.                                                                         |
| `llms-txt-valid`               | Medium   | 4      | Structure helps parsing, but even non-standard llms.txt with links is useful.                                                                         |
| `content-negotiation`          | Medium   | 4      | Only some agents send Accept: text/markdown. Valuable but not universal.                                                                              |
| `content-start-position`       | Medium   | 4      | Boilerplate preamble on HTML path wastes truncation budget.                                                                                           |
| `tabbed-content-serialization` | Medium   | 4      | Tabbed content can be catastrophic but only affects pages that use it.                                                                                |
| `markdown-code-fence-validity` | Medium   | 4      | Unclosed fences corrupt all content after the break point.                                                                                            |
| `llms-txt-coverage`            | Medium   | 4      | Stale index is a slow failure mode; broken links catch the acute version.                                                                             |
| `markdown-content-parity`      | Medium   | 4      | Content drift between markdown and HTML leaves agents with outdated info.                                                                             |
| `auth-alternative-access`      | Medium   | 4      | Partial mitigation for auth-gated sites.                                                                                                              |
| `redirect-behavior`            | Medium   | 4      | Cross-host redirects are a known friction point for some agents.                                                                                      |
| `section-header-quality`       | Low      | 2      | Refinement for tabbed content; only matters when tabs exist.                                                                                          |
| `cache-header-hygiene`         | Low      | 2      | Aggressive caching rarely causes acute agent failures.                                                                                                |

**Maximum raw score**: 3(10) + 8(7) + 9(4) + 2(2) = 30 + 56 + 36 + 4 = **126 points**

---

## Scoring Formula

### Per-Check Score

For **single-resource checks** (e.g., `llms-txt-exists`, `llms-txt-valid`):

```
check_score = status_coefficient * weight

status_coefficient:
  pass  = 1.0
  warn  = warn_coefficient (see table below)
  fail  = 0.0
  skip  = excluded from both numerator and denominator
  error = 0.0
```

For **multi-page checks** with per-page breakdowns in `details`:

```
proportion = (pass_count * 1.0 + warn_count * warn_coefficient) / tested_count
check_score = proportion * weight
```

### Warn Coefficients

Not all warn states represent the same degree of degradation. Some mean "works
with a cosmetic issue" while others mean "genuinely degraded with real risk."
Each check has a specific warn coefficient rather than a uniform default.

| Check ID                                                     | Warn coeff | Rationale                                                                                                                                                                                    |
| ------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.75: Content substantively intact**                       |            |                                                                                                                                                                                              |
| `llms-txt-valid`                                             | 0.75       | Non-standard structure, but links are parseable. Missing a blockquote doesn't prevent navigation.                                                                                            |
| `content-negotiation`                                        | 0.75       | Agent gets the markdown content; wrong Content-Type may prevent optimizations but the content itself is correct.                                                                             |
| `llms-txt-links-resolve`                                     | 0.75       | >90% of links work. A few broken links is a maintenance issue, not a structural one.                                                                                                         |
| `llms-txt-coverage`                                          | 0.75       | 80-95% of pages covered. Most of the site is represented in the index.                                                                                                                       |
| `markdown-content-parity`                                    | 0.75       | Minor formatting differences, not substantive content drift.                                                                                                                                 |
| **0.60: Partial coverage or platform-dependent**             |            |                                                                                                                                                                                              |
| `llms-txt-directive`                                         | 0.60       | Present on some pages but not others. Agents that land on covered pages benefit; others get no guidance.                                                                                     |
| `redirect-behavior`                                          | 0.60       | Cross-host HTTP redirects: some agents follow them, some don't. Platform-dependent outcome.                                                                                                  |
| **0.25: Actively steering agents away from the better path** |            |                                                                                                                                                                                              |
| `llms-txt-links-markdown`                                    | 0.25       | Markdown variants exist but llms.txt links to HTML. The one place you control agent navigation actively directs agents away from markdown. Agents don't independently discover .md variants. |
| **0.50: Genuine functional degradation**                     |            |                                                                                                                                                                                              |
| `llms-txt-exists`                                            | 0.50       | Only reachable via cross-host redirect. Binary: the agent's HTTP client either follows it or doesn't.                                                                                        |
| `llms-txt-size`                                              | 0.50       | 50K-100K characters. Real truncation risk on some agent platforms.                                                                                                                           |
| `rendering-strategy`                                         | 0.50       | Sparse content that may need JS. Genuinely uncertain whether agents get usable content.                                                                                                      |
| `markdown-url-support`                                       | 0.50       | Inconsistent .md support across pages. Unpredictable is arguably worse than consistently absent.                                                                                             |
| `page-size-markdown`                                         | 0.50       | 50K-100K characters. Real truncation risk.                                                                                                                                                   |
| `page-size-html`                                             | 0.50       | 50K-100K characters post-conversion. Same truncation risk pattern.                                                                                                                           |
| `content-start-position`                                     | 0.50       | 10-50% boilerplate before content. Real waste of truncation budget.                                                                                                                          |
| `tabbed-content-serialization`                               | 0.50       | 50K-100K serialized. Truncation risk for tab-heavy pages.                                                                                                                                    |
| `section-header-quality`                                     | 0.50       | 25-50% generic headers. Agents lose variant context on a significant fraction.                                                                                                               |
| `cache-header-hygiene`                                       | 0.50       | 1-24 hour caching. Updates may take hours to propagate.                                                                                                                                      |
| `auth-gate-detection`                                        | 0.50       | Partial gating. Some docs accessible, some invisible to agents.                                                                                                                              |
| `auth-alternative-access`                                    | 0.50       | Partial alternative access. Covers some gated content but not all.                                                                                                                           |

Checks without a warn state (`http-status-codes`,
`markdown-code-fence-validity`) don't appear in this table. Their spec
definitions only have pass and fail levels.

This replaces the worst-case aggregation for scoring purposes. A site where
3/50 pages exceed the size limit scores ~94% of the check's weight, not 0%.

The top-level `status` field is unchanged and still uses worst-case for the
existing text/json formatters; proportional scoring is only applied in the
scoring layer.

### Detail Fields Used for Proportional Scoring

Every multi-page check already stores the data needed. The scoring module reads
these fields from `details`:

| Check ID                       | Proportion source                                                         |
| ------------------------------ | ------------------------------------------------------------------------- |
| `rendering-strategy`           | `serverRendered`, `sparseContent`, `spaShells` (as pass/warn/fail counts) |
| `page-size-markdown`           | `passBucket`, `warnBucket`, `failBucket`                                  |
| `page-size-html`               | `passBucket`, `warnBucket`, `failBucket`                                  |
| `content-start-position`       | `passBucket`, `warnBucket`, `failBucket`                                  |
| `markdown-url-support`         | `pageResults` array, count per-status                                     |
| `content-negotiation`          | `pageResults` array, count per-status                                     |
| `markdown-code-fence-validity` | `pageResults` array, count per-status                                     |
| `tabbed-content-serialization` | `pageResults` array, count per-status                                     |
| `section-header-quality`       | `pageResults` array, count per-status                                     |
| `http-status-codes`            | `pageResults` array, count per-status                                     |
| `redirect-behavior`            | `pageResults` array, count per-status                                     |
| `llms-txt-directive`           | `pageResults` array, count per-status                                     |
| `cache-header-hygiene`         | `passBucket`, `warnBucket`, `failBucket`                                  |
| `markdown-content-parity`      | `passBucket`, `warnBucket`, `failBucket`                                  |
| `auth-gate-detection`          | `pageResults` array, count per-status                                     |

Single-resource checks (no proportional scoring needed):

| Check ID                  | Notes                                                         |
| ------------------------- | ------------------------------------------------------------- |
| `llms-txt-exists`         | Binary: exists or doesn't                                     |
| `llms-txt-valid`          | Per-file average (see note below)                             |
| `llms-txt-size`           | Per-file average (see note below)                             |
| `llms-txt-links-resolve`  | Uses resolve rate directly from details (`resolveRate` field) |
| `llms-txt-links-markdown` | Percentage-based status                                       |
| `llms-txt-coverage`       | Coverage percentage                                           |
| `auth-alternative-access` | Binary: alternative path exists or doesn't                    |

For `llms-txt-links-resolve`, the `resolveRate` field in details (a 0-1 float)
can be used directly as the proportion rather than mapping from status.

**Multiple llms.txt files**: When a site serves llms.txt at multiple locations
(e.g., `/llms.txt` and `/docs/llms.txt`), per-file checks (`llms-txt-valid`,
`llms-txt-size`, `llms-txt-links-resolve`, `llms-txt-links-markdown`) score
each file individually and average the results. This reflects that we can't
predict which file an agent will encounter, so the score should represent
the expected experience across discovery paths. Files that redirect to the
same destination are deduplicated before scoring (e.g., if `/docs/llms.txt`
308-redirects to `/llms.txt`, that's one file, not two).

### Overall Score

```
score = (sum of check_scores for non-skipped checks)
      / (sum of weights for non-skipped checks)
      * 100
```

Rounded to the nearest integer.

### Critical Check Score Caps

Critical checks (weight 10) can cap the overall score when they fail broadly.
This prevents a site with a fundamental agent-blocking problem from scoring
well on the strength of lower-priority checks alone.

The cap is based on the check's **proportion score** (for multi-page checks)
or its **status** (for single-resource checks):

```
For each critical check:
  if single-resource AND status == fail:
    apply cap (total failure)
  if multi-page AND proportion <= 0.25 (75%+ of pages fail):
    cap overall score at 39 (F)
  if multi-page AND proportion <= 0.50 (50%+ of pages fail):
    cap overall score at 59 (D)
```

For single-resource critical checks:

| Check                  | Cap                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `llms-txt-exists` fail | Cap at 59 (D). Agents lose primary navigation but may still use HTML/markdown paths directly. |

`llms-txt-exists` caps at D rather than F because a site without llms.txt can
still be usable if it has good rendering, reasonable page sizes, and
discoverable markdown. It's a significant gap, not a total blocker.

For multi-page critical checks (`rendering-strategy`, `auth-gate-detection`):

| Proportion | Meaning                    | Cap                                     |
| ---------- | -------------------------- | --------------------------------------- |
| <= 0.25    | 75%+ of pages affected     | Cap at 39 (F)                           |
| <= 0.50    | 50%+ of pages affected     | Cap at 59 (D)                           |
| > 0.50     | Minority of pages affected | No cap; proportional scoring handles it |

### Diagnostic-Driven Cap: `no-viable-path`

When the `no-viable-path` interaction diagnostic fires (no llms.txt, no
discoverable markdown, HTML path broken or untested), the overall score is
capped at 39 (F). A site where agents have no effective way to access content
should not score above F regardless of how well the infrastructure checks
perform.

When multiple caps apply, the lowest cap wins.

The cap is applied **after** the weighted score calculation but diagnostics
are evaluated first so that diagnostic-driven caps can participate. If the
calculated score is already below the cap, the cap has no effect. The
scorecard output should note when a cap is active, e.g.:

```
  Overall Score: 39 / 100 (F)
  (Capped: auth-gate-detection — all documentation requires authentication)
```

---

## Cluster Coefficients (Interaction Effects)

Some checks have **conditional value**: their contribution to the score should
be scaled by whether the conditions needed to realize that value are actually
met. This is modeled as a coefficient (0.0 to 1.0) that multiplies a check's
score after the base calculation.

### Discovery Coefficient

**Applies to**: `page-size-markdown`, `markdown-code-fence-validity`,
`markdown-content-parity`

These checks measure the quality of the markdown path. That path's value to
agents depends on whether agents can discover it. In observed agent behavior,
agents do not independently discover .md URL variants through training data
or exploratory probing; they need to be told. This means undiscoverable
markdown delivers zero value to agents today.

`markdown-url-support` is excluded from this coefficient because it measures
whether the capability exists, not the quality of an established path. A site
should get credit for serving markdown (and the `markdown-undiscoverable`
diagnostic tells them to make it discoverable), but the downstream quality
checks only matter if agents actually reach the markdown.

```
discovery_coefficient:
  content-negotiation pass      -> 1.0  (mechanical; no agent decision involved)
  llms-txt-directive pass       -> 0.8  (effective but agents sometimes ignore
                                         the directive even when present)
  llms-txt-links-markdown pass  -> 0.5  (requires finding llms.txt first,
                                         then following .md links from it)
  none of the above             -> 0.0  (agents won't find the markdown path)
```

If multiple conditions are met, use the highest coefficient. These values
are based on observed agent behavior as of early 2026 and may need
recalibration as agent tooling evolves.

### HTML Path Coefficient

**Applies to**: `page-size-html`, `content-start-position`,
`tabbed-content-serialization`, `section-header-quality`

These checks measure the quality of the HTML path. If pages are SPA shells,
HTML path measurements for those pages are meaningless.

```
html_path_coefficient = rendering-strategy proportion
```

The coefficient uses the same proportion as the `rendering-strategy` check's
own score: `(pass_count * 1.0 + warn_count * 0.5) / tested_count`. If 45/50
pages render correctly, the coefficient is 0.9. If 5/50 render correctly,
it's 0.1. This is consistent with proportional scoring throughout the system
and avoids double-discounting (the HTML path checks' own proportional scoring
handles per-page variation; the coefficient reflects the overall reliability
of the HTML path as a whole).

### Index Truncation Coefficient

**Applies to**: `llms-txt-links-resolve`, `llms-txt-valid`,
`llms-txt-coverage`, `llms-txt-links-markdown`

If `llms-txt-size` fails, agents only see a fraction of the index. The quality
of the invisible portion doesn't affect agent experience.

```
index_truncation_coefficient:
  llms-txt-size pass  -> 1.0  (full index visible to agents)
  llms-txt-size warn  -> 0.8  (most visible, some platforms may truncate)
  llms-txt-size fail  -> visible_fraction  (estimated from file size vs.
                                            truncation limit, e.g., 100K / file_size)
```

For the fail case, the coefficient is derived from the actual file size in
`details`. A 200K file has coefficient ~0.5; a 4MB file has coefficient ~0.025.

### Auth Coefficient

**Applies to**: all non-auth checks collectively

If `auth-gate-detection` fails (all/most pages require auth), the other checks
are measuring resources that agents can't reach anyway. However, this is
complex to apply uniformly because some resources (llms.txt, markdown endpoints)
might be public even when the HTML docs are gated.

**v1 approach**: Don't apply a blanket auth coefficient. Instead, surface this
as an interaction diagnostic (see below). The `auth-gate-detection` check's
own weight (Critical, 10 points) already provides significant score impact.
Revisit in v2 if the diagnostic alone isn't sufficient.

### Applying Coefficients

A check may be subject to multiple coefficients. When this happens, multiply
them together:

```
effective_score = base_check_score * coefficient_1 * coefficient_2 * ...
```

In the current design, the three coefficient groups (discovery, HTML path,
index truncation) apply to disjoint sets of checks, so no check currently
has more than one coefficient. The multiplication rule is documented for
future extensibility if new coefficients are added that overlap with existing
ones.

The effective weight denominator for the overall score should use the same
coefficients:

```
effective_max = weight * coefficient_1 * coefficient_2 * ...
```

This ensures that a check whose coefficient is reduced contributes
proportionally less to both the numerator and denominator, rather than
deflating the score by having full weight in the denominator but reduced
score in the numerator. When a coefficient is 0.0 (e.g., discovery
coefficient with no discovery mechanism), the check is effectively excluded
from the score entirely.

---

## Interaction Diagnostics

Interaction diagnostics are system-level findings that emerge from patterns
across multiple check results. They are displayed in the scorecard output as
a separate section, distinct from individual check results.

Each diagnostic has:

- **ID**: For programmatic use
- **Trigger condition**: Boolean expression over check statuses
- **Severity**: `critical` | `warning` | `info`
- **Message**: 2-4 sentences explaining the system-level impact
- **Resolution**: What to do about it

Some diagnostics reference the trigger state of other diagnostics (e.g.,
`page-size-no-markdown-escape` references whether markdown is undiscoverable).
The implementation must evaluate diagnostics in dependency order:
`markdown-undiscoverable` first, then diagnostics that reference it.

### Diagnostic Definitions

#### `markdown-undiscoverable`

- **Severity**: warning
- **Triggers when**: `markdown-url-support` passes, AND all of
  (`content-negotiation`, `llms-txt-directive`, `llms-txt-links-markdown`)
  are not pass.
- **Message**: Your site serves markdown at .md URLs, but agents have no way
  to discover this. Without content negotiation, an llms.txt directive on your
  pages, or .md links in your llms.txt, most agents will default to the HTML
  path. Your markdown support is not being utilized.
- **Resolution**: Add a blockquote directive near the top of each docs page
  pointing to your llms.txt, or implement content negotiation for
  `Accept: text/markdown`. Either change makes your existing markdown support
  discoverable.

#### `truncated-index`

- **Severity**: warning
- **Triggers when**: `llms-txt-exists` passes AND `llms-txt-size` fails.
- **Message**: Your llms.txt is {size} characters. Agents see roughly the
  first {truncation_limit} characters ({visible_pct}% of the file). Links,
  structure, and freshness beyond that point don't affect agent experience.
  Quality checks on the invisible portion are discounted in the score.
- **Resolution**: Split into a root index linking to section-level llms.txt
  files, each under 50,000 characters. See the spec's progressive disclosure
  recommendation.

#### `spa-shell-html-invalid`

- **Severity**: info
- **Triggers when**: `rendering-strategy` fails or warns (proportionally:
  when >25% of sampled pages are SPA shells).
- **Message**: {n} of {total} sampled pages use client-side rendering. Agents
  receive an empty shell for these pages instead of documentation content.
  Page size and content structure scores for the HTML path are discounted
  because they are partially measuring shells rather than content.
  {If markdown-url-support passes: "Your markdown path still works for agents
  that can discover it."} {If not: "Agents currently have no alternative path
  to content on affected pages."}
- **Resolution**: Enable server-side rendering or static generation for
  affected page types. If only specific page templates use client-side content
  loading, target those templates rather than rebuilding the entire site.

#### `no-viable-path`

- **Severity**: critical
- **Triggers when**: (`llms-txt-exists` fails OR (`llms-txt-exists` passes
  AND `llms-txt-links-resolve` resolveRate < 10%)) AND
  (`rendering-strategy` fails OR `rendering-strategy` not run) AND
  (`markdown-url-support` fails OR markdown is undiscoverable per
  `markdown-undiscoverable` trigger).

  The expanded llms.txt condition recognizes that an llms.txt where <10% of
  links resolve is functionally equivalent to having no llms.txt: agents
  follow the links with high confidence and hit dead ends.

- **Message**: Agents have no effective way to access your documentation.
  {If llms-txt-exists fails: "There is no llms.txt for navigation."}
  {If llms-txt-exists passes but links broken: "The llms.txt exists but only
  {resolveRate}% of links resolve, making it effectively unusable."}
  No discoverable markdown path, and the HTML responses either don't contain
  content or weren't tested. This is the lowest-possible agent accessibility
  state.
- **Resolution**: The single highest-impact action is creating an llms.txt
  at your site root with working links. If your site uses client-side
  rendering, enabling server-side rendering is the second priority.
- **Score cap**: When this diagnostic fires, the overall score is capped at
  39 (F). See "Diagnostic-Driven Cap" in the Score Caps section.

#### `auth-no-alternative`

- **Severity**: critical
- **Triggers when**: `auth-gate-detection` is fail AND
  `auth-alternative-access` is fail.
- **Message**: Your documentation requires authentication, and no alternative
  access paths were detected. Agents that encounter your docs will fall back
  on training data or seek secondary sources that may be inaccurate.
- **Resolution**: Consider providing a public llms.txt as a navigational
  index, ungating API references and integration guides, or shipping docs
  with your SDK/package. See the spec's "Making Private Docs
  Agent-Accessible" section for options ordered by implementation effort.

#### `page-size-no-markdown-escape`

- **Severity**: warning
- **Triggers when**: `page-size-html` fails AND (`markdown-url-support` fails
  OR markdown is undiscoverable).
- **Message**: {n} pages exceed agent truncation limits on the HTML path, and
  there is no discoverable markdown path for agents to get smaller
  representations. Agents will silently receive truncated content on these
  pages.
- **Resolution**: Either reduce HTML page sizes (break large pages, reduce
  inline CSS/JS), or provide markdown versions and ensure agents can discover
  them via content negotiation or an llms.txt directive.

---

## Score Display

### Letter Grades

| Grade | Score | Description                                                                  |
| ----- | ----- | ---------------------------------------------------------------------------- |
| A+    | 100   | Perfect. Every check passes.                                                 |
| A     | 90-99 | Excellent. Agents can effectively navigate and consume this documentation.   |
| B     | 80-89 | Good. Minor improvements possible; agents can use most content.              |
| C     | 70-79 | Functional but with notable gaps. Some content is inaccessible or degraded.  |
| D     | 60-69 | Significant barriers. Agents struggle to use this documentation effectively. |
| F     | 0-59  | Poor. Agents likely cannot use this documentation in a meaningful way.       |

### Scorecard Output Structure

```
Agent-Friendly Docs Scorecard
==============================

  Overall Score: 72 / 100 (C)

  Category Scores:
    Content Discoverability           72 / 100 (C)
    Markdown Availability             60 / 100 (C)
    Page Size and Truncation Risk     45 / 100 (D)
    Content Structure                 90 / 100 (A)
    URL Stability and Redirects      100 / 100 (A)
    Observability and Content Health  75 / 100 (B)
    Authentication and Access        100 / 100 (A)

  Interaction Diagnostics:
    [!] Markdown support is undiscoverable
        Your site serves markdown at .md URLs, but agents have no way to
        discover this. Without content negotiation, an llms.txt directive
        on your pages, or .md links in your llms.txt, most agents will
        default to the HTML path.

        Fix: Add a blockquote directive near the top of each docs page
        pointing to your llms.txt, or implement content negotiation for
        Accept: text/markdown.

    [!] Pages exceed size limits with no markdown escape
        12 pages exceed agent truncation limits on the HTML path, and
        there is no discoverable markdown path for smaller representations.

        Fix: Reduce HTML page sizes or provide discoverable markdown versions.

  Check Results:

    Content Discoverability
      PASS  llms-txt-exists        llms.txt found at /llms.txt
      PASS  llms-txt-valid         Follows standard structure with H1, ...
      WARN  llms-txt-size          llms.txt is 65,000 characters
            Fix: If it grows further, split into nested llms.txt files ...
      PASS  llms-txt-links-resolve All links resolve
      FAIL  llms-txt-links-markdown Links point to HTML, not markdown
            Fix: Update links to use .md URL variants ...
      FAIL  llms-txt-directive     No directive detected on any tested page
            Fix: Add a blockquote near the top of each page pointing to ...

    ...
```

### Category Score Calculation

Each category's score is calculated the same way as the overall score, but
only including checks in that category:

```
category_score = (sum of effective check_scores in category)
               / (sum of effective max weights in category)
               * 100
```

Where "effective" means after applying cluster coefficients.
