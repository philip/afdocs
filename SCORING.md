# How the Agent-Friendly Docs Score Works

Scoring Version: 0.1.0 · [Agent-Friendly Docs Spec v0.3.0](https://agentdocsspec.com) · March 2026

## What is this score?

The Agent-Friendly Docs Scorecard measures how effectively AI coding agents can discover, navigate, and consume a documentation site. It runs 23 automated checks against your site and produces a 0–100 score with a letter grade.

Each check corresponds to a section of the [Agent-Friendly Docs Spec](https://agentdocsspec.com), which documents what the check measures, why it matters for real agent workflows, and the observed behaviors that motivated it. This document covers how checks are **scored**, not what they **measure**. If you want to understand a specific check in depth, follow the spec links in the table below.

The score reflects how well agents can _actually use_ your documentation, not just how many boxes are ticked. A site with perfect markdown support that no agent can discover scores lower than a site with imperfect markdown that agents are directed to.

## Grade bands

| Grade  | Score | What it means                                                                          |
| ------ | ----- | -------------------------------------------------------------------------------------- |
| **A+** | 100   | Every check passes. Agents can fully navigate and consume your docs.                   |
| **A**  | 90–99 | Excellent. Agents can effectively use your documentation with minimal friction.        |
| **B**  | 80–89 | Good. Minor improvements possible; most content is accessible to agents.               |
| **C**  | 70–79 | Functional but with notable gaps. Some content is inaccessible or degraded for agents. |
| **D**  | 60–69 | Significant barriers. Agents struggle to use your documentation effectively.           |
| **F**  | 0–59  | Agents likely cannot use your documentation in a meaningful way.                       |

## What we check

The 23 checks are grouped into seven categories. Each check is assigned a **weight tier** based on its observed impact on agent workflows:

- **Critical (10 pts)**: Agents cannot function without this. Failure means zero content, zero navigation, or zero access.
- **High (7 pts)**: Directly limits agent effectiveness. Failure means truncation, dead ends, or agents stuck on a worse path.
- **Medium (4 pts)**: Significant but not blocking. Failure degrades quality or misses an opportunity.
- **Low (2 pts)**: Refinements. Failure is a missed best practice, not an agent-blocking issue.

### Content Discoverability

How agents find and navigate your documentation.

| Check                                                                              | Weight        | What it measures                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [llms-txt-exists](https://agentdocsspec.com/spec/#llms-txt-exists)                 | Critical (10) | Whether your site has an llms.txt file. The primary navigation mechanism for agents.                                     |
| [llms-txt-valid](https://agentdocsspec.com/spec/#llms-txt-valid)                   | Medium (4)    | Whether your llms.txt follows standard structure so agents can parse it reliably.                                        |
| [llms-txt-size](https://agentdocsspec.com/spec/#llms-txt-size)                     | High (7)      | Whether your llms.txt fits within agent context windows. Truncated indexes defeat their purpose.                         |
| [llms-txt-links-resolve](https://agentdocsspec.com/spec/#llms-txt-links-resolve)   | High (7)      | Whether links in your llms.txt actually work. Broken links send agents down dead ends with high confidence.              |
| [llms-txt-links-markdown](https://agentdocsspec.com/spec/#llms-txt-links-markdown) | High (7)      | Whether llms.txt links point to markdown rather than HTML. Agents work significantly less effectively with HTML content. |
| [llms-txt-directive-html](https://agentdocsspec.com/spec/#llms-txt-directive-html) | High (7)      | Whether your HTML pages tell agents where to find llms.txt. Without this, agents won't know it exists.                   |
| [llms-txt-directive-md](https://agentdocsspec.com/spec/#llms-txt-directive-md)     | Medium (4)    | Whether your markdown pages tell agents where to find llms.txt.                                                          |

### Markdown Availability

Whether agents can get documentation in their preferred format.

| Check                                                                        | Weight     | What it measures                                                                                     |
| ---------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| [markdown-url-support](https://agentdocsspec.com/spec/#markdown-url-support) | High (7)   | Whether appending .md to a URL returns markdown. This is the core format capability agents look for. |
| [content-negotiation](https://agentdocsspec.com/spec/#content-negotiation)   | Medium (4) | Whether your server returns markdown when agents request it via `Accept: text/markdown`.             |

### Page Size and Truncation Risk

Whether agents can process your pages without losing content.

| Check                                                                            | Weight        | What it measures                                                                                      |
| -------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| [rendering-strategy](https://agentdocsspec.com/spec/#rendering-strategy)         | Critical (10) | Whether pages use server-side rendering. Client-side (SPA) pages deliver empty shells to agents.      |
| [page-size-markdown](https://agentdocsspec.com/spec/#page-size-markdown)         | High (7)      | Whether markdown pages fit within agent processing limits (~100K characters).                         |
| [page-size-html](https://agentdocsspec.com/spec/#page-size-html)                 | High (7)      | Whether HTML pages, once converted to text, fit within agent processing limits.                       |
| [content-start-position](https://agentdocsspec.com/spec/#content-start-position) | Medium (4)    | Whether documentation content starts near the top of the page, or is buried under boilerplate CSS/JS. |

### Content Structure

Whether page content is structured in ways agents can consume.

| Check                                                                                        | Weight     | What it measures                                                                                        |
| -------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| [tabbed-content-serialization](https://agentdocsspec.com/spec/#tabbed-content-serialization) | Medium (4) | Whether tabbed UI components serialize to a reasonable size. Tabs can multiply page size dramatically.  |
| [section-header-quality](https://agentdocsspec.com/spec/#section-header-quality)             | Low (2)    | Whether headers in tabbed sections include variant context (e.g., "Step 1 (Python)" vs. just "Step 1"). |
| [markdown-code-fence-validity](https://agentdocsspec.com/spec/#markdown-code-fence-validity) | Medium (4) | Whether code fences are properly closed. An unclosed fence corrupts all content after the break point.  |

### URL Stability and Redirects

Whether documentation URLs behave predictably for agents.

| Check                                                                  | Weight     | What it measures                                                                                        |
| ---------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| [http-status-codes](https://agentdocsspec.com/spec/#http-status-codes) | High (7)   | Whether missing pages return 404. Soft 404s (returning 200 with error content) actively mislead agents. |
| [redirect-behavior](https://agentdocsspec.com/spec/#redirect-behavior) | Medium (4) | Whether redirects use standard HTTP methods. Cross-host and JavaScript redirects break many agents.     |

### Observability and Content Health

Whether agent-facing resources stay accurate over time.

| Check                                                                              | Weight     | What it measures                                                                                           |
| ---------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| [llms-txt-coverage](https://agentdocsspec.com/spec/#llms-txt-coverage)             | Medium (4) | Whether your llms.txt reflects your current site. A stale index sends agents to outdated or missing pages. |
| [markdown-content-parity](https://agentdocsspec.com/spec/#markdown-content-parity) | Medium (4) | Whether markdown and HTML versions of pages contain the same content.                                      |
| [cache-header-hygiene](https://agentdocsspec.com/spec/#cache-header-hygiene)       | Low (2)    | Whether cache lifetimes allow content updates to reach agents in a reasonable timeframe.                   |

### Authentication and Access

Whether agents can reach your documentation at all.

| Check                                                                              | Weight        | What it measures                                                                                     |
| ---------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| [auth-gate-detection](https://agentdocsspec.com/spec/#auth-gate-detection)         | Critical (10) | Whether documentation requires authentication. Auth-gated docs are invisible to agents.              |
| [auth-alternative-access](https://agentdocsspec.com/spec/#auth-alternative-access) | Medium (4)    | Whether auth-gated sites provide alternative access paths (public llms.txt, SDK-bundled docs, etc.). |

## How the score is calculated

### Individual check scores

Each check earns a proportion of its weight based on its result:

- **Pass**: Full weight
- **Warn**: Partial weight (see [warn coefficients](#warn-coefficients) below)
- **Fail**: Zero
- **Skip**: Excluded entirely (the dependency that caused the skip already carries the penalty)

For checks that test multiple pages (like `page-size-html` or `rendering-strategy`), the score is proportional. If 3 out of 50 pages fail, the check scores ~94% of its weight, not zero. This design choice provides partial credit for partial success/failure: a site where a few pages exceed size limits is very different from one where nearly all do.

### Overall score

```
score = (sum of check scores) / (sum of weights for non-skipped checks) × 100
```

Rounded to the nearest integer.

### Warn coefficients

Not all warnings represent the same degree of degradation. A warning on `llms-txt-valid` (structure is non-standard but links are parseable) is less severe than a warning on `rendering-strategy` (sparse content that might need JavaScript). Most checks have a specific warn coefficient:

| Coefficient | Meaning                                  | Checks                                                                                                                                                                                                                                                                                 |
| ----------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.75**    | Content substantively intact             | `llms-txt-valid`, `content-negotiation`, `llms-txt-links-resolve`, `llms-txt-coverage`, `markdown-content-parity`                                                                                                                                                                      |
| **0.60**    | Partial coverage or platform-dependent   | `llms-txt-directive-html`, `llms-txt-directive-md`, `redirect-behavior`                                                                                                                                                                                                                |
| **0.50**    | Genuine functional degradation           | `llms-txt-exists`, `llms-txt-size`, `rendering-strategy`, `markdown-url-support`, `page-size-markdown`, `page-size-html`, `content-start-position`, `tabbed-content-serialization`, `section-header-quality`, `cache-header-hygiene`, `auth-gate-detection`, `auth-alternative-access` |
| **0.25**    | Actively steering agents to a worse path | `llms-txt-links-markdown` (markdown exists but llms.txt links to HTML; agents don't discover .md variants on their own)                                                                                                                                                                |

Checks that only have pass/fail (no warn state): `http-status-codes`, `markdown-code-fence-validity`.

## Score caps

Some problems are severe enough that no amount of other good behavior should compensate for them. When a critical issue is detected, the score is capped regardless of how well everything else performs.

**Example**: A site that requires authentication for all documentation pages can't score above D (59), even if the few public pages it has are perfectly structured. A site where agents have no viable path to any content at all can't score above F (39).

### Critical check caps

| Condition                                          | Cap    | Why                                                                            |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `llms-txt-exists` fails                            | 59 (D) | Agents lose primary navigation but may still use HTML/markdown paths directly. |
| `rendering-strategy`: 75%+ of pages are SPA shells | 39 (F) | Most content is invisible to agents.                                           |
| `rendering-strategy`: 50%+ of pages are SPA shells | 59 (D) | Significant content is invisible to agents.                                    |
| `auth-gate-detection`: 75%+ of pages require auth  | 39 (F) | Most documentation is inaccessible.                                            |
| `auth-gate-detection`: 50%+ of pages require auth  | 59 (D) | Significant documentation is inaccessible.                                     |
| `no-viable-path` diagnostic fires (see below)      | 39 (F) | Agents have no effective way to access content at all.                         |

When multiple caps apply, the lowest one wins.

## Interaction diagnostics

Some problems only become visible when you look at multiple checks together. The scorecard surfaces these as **interaction diagnostics**: system-level findings that emerge from combinations of check results.

### Markdown support is undiscoverable

**Triggers when** your site serves markdown at .md URLs, but there is no agent-facing directive on HTML pages pointing to llms.txt and the server does not support content negotiation.

**What it means**: You've done the work to support markdown, but agents have no way to find out. They'll default to the HTML path. In observed agent behavior, agents do not independently discover .md URL variants; they need to be told.

**What to do**: Add a directive on your docs pages pointing to llms.txt, and implement content negotiation for `Accept: text/markdown`. The directive is the primary discovery mechanism because it reaches all agents; content negotiation provides a fast path for agents that request markdown by default. Both are recommended.

### Markdown support is only partially discoverable

**Triggers when** your site serves markdown at .md URLs and supports content negotiation, but there is no agent-facing directive on HTML pages pointing to llms.txt.

**What it means**: Agents that send `Accept: text/markdown` (Claude Code, Cursor, OpenCode) get markdown automatically, but the majority of agents fetch HTML by default and have no signal that a markdown path exists.

**What to do**: Add a directive near the top of each HTML page pointing to your llms.txt. If your site serves markdown, mention that in the directive too. The directive reaches all agents, not just the ones that request markdown by default.

### Truncated index

**Triggers when** your llms.txt exists but exceeds agent context limits.

**What it means**: Agents see roughly the first 50K–100K characters of your llms.txt. Links, structure, and content beyond that point don't affect agent experience. Quality checks on the invisible portion are discounted in the score.

**What to do**: Split into a root index linking to section-level llms.txt files, each under 50,000 characters.

### SPA shells invalidate HTML path

**Triggers when** more than 25% of sampled pages use client-side rendering.

**What it means**: Agents receive empty shells instead of documentation. Page size and content structure scores for the HTML path are discounted because they're partially measuring shells, not content.

**What to do**: Enable server-side rendering or static generation for documentation pages. If only specific page templates use client-side content loading, target those templates.

### No viable path to content

**Triggers when** there's no working llms.txt (missing or nearly all links broken), no server-rendered HTML, and no discoverable markdown path. This is the lowest-possible agent accessibility state.

**What it means**: Agents have no effective way to access your documentation. They will fall back on training data or secondary sources.

**What to do**: The single highest-impact action is creating an llms.txt at your site root with working links. If your site uses client-side rendering, enabling server-side rendering is the second priority.

**Score impact**: This diagnostic caps the score at 39 (F).

### Auth-gated with no alternative

**Triggers when** all documentation requires authentication and no alternative access paths exist.

**What it means**: Agents that encounter your docs will fall back on training data or secondary sources that may be inaccurate.

**What to do**: Consider providing a public llms.txt, ungating API references and integration guides, or shipping docs with your SDK. The [spec's "Making Private Docs Agent-Accessible" section](https://agentdocsspec.com) covers options ordered by implementation effort.

### Pages exceed size limits with no markdown escape

**Triggers when** HTML pages exceed agent truncation limits and there's no discoverable markdown path that could offer smaller representations.

**What it means**: Agents will silently receive truncated content on oversized pages, with no alternative path to the full content.

**What to do**: Either reduce HTML page sizes (break large pages, reduce inline CSS/JS) or provide markdown versions and make them discoverable.

## Cluster coefficients

Some checks have **conditional value**: their contribution depends on whether the conditions needed to realize that value are actually met. The score accounts for this through cluster coefficients that scale a check's contribution up or down.

### Discovery coefficient

**Affects**: `page-size-markdown`, `markdown-code-fence-validity`, `markdown-content-parity`

These checks measure the quality of the markdown path. But if agents can't _discover_ that path, the quality is irrelevant. The coefficient reflects how discoverable your markdown is:

| Condition                   | Coefficient | Why                                                                |
| --------------------------- | ----------- | ------------------------------------------------------------------ |
| Content negotiation passes  | 1.0         | Agents get markdown automatically; no decision involved.           |
| llms.txt directive passes   | 0.8         | Effective, but agents sometimes ignore the directive.              |
| llms.txt links use .md URLs | 0.5         | Agents must find llms.txt first, then follow .md links from it.    |
| None of the above           | 0.0         | Agents won't find the markdown path. Check is excluded from score. |

If multiple conditions are met, the highest coefficient applies.

`markdown-url-support` is intentionally excluded from this coefficient. It measures whether the capability _exists_, not the quality of an established path. A site should get credit for serving markdown; the discovery coefficient only applies to the downstream quality checks.

### HTML path coefficient

**Affects**: `page-size-html`, `content-start-position`, `tabbed-content-serialization`, `section-header-quality`

If pages are SPA shells, measuring HTML quality is meaningless. This coefficient equals the `rendering-strategy` check's proportion: if 90% of pages render correctly, these checks count for 90% of their weight.

### Index truncation coefficient

**Affects**: `llms-txt-links-resolve`, `llms-txt-valid`, `llms-txt-coverage`, `llms-txt-links-markdown`

If your llms.txt is truncated, agents only see part of the index. Measuring the quality of the invisible portion doesn't reflect agent experience.

| Condition                        | Coefficient                                              |
| -------------------------------- | -------------------------------------------------------- |
| `llms-txt-size` passes           | 1.0                                                      |
| `llms-txt-size` warns (50K–100K) | 0.8                                                      |
| `llms-txt-size` fails (>100K)    | Proportional to visible fraction (e.g., 200K file ≈ 0.5) |

### How coefficients combine

When a check is subject to multiple coefficients, they multiply together. Both the check's score _and_ its weight in the denominator are scaled by the same coefficients, so a discounted check contributes proportionally less to the overall score rather than dragging it down.

In the current scoring version, the three coefficient groups apply to disjoint sets of checks, so no check has more than one coefficient.

---

_Weights, coefficients, and thresholds in this document reflect observed agent behavior as of early 2026 and will evolve as agent tooling changes. The [Agent-Friendly Docs Spec](https://agentdocsspec.com) is the authoritative reference for what each check measures and why._
