# Interaction Diagnostics

Some problems only become visible when you look at multiple checks together. The scorecard surfaces these as **interaction diagnostics**: system-level findings that emerge from combinations of check results.

These diagnostics appear in the "Interaction Diagnostics" section of the `--format scorecard` output and as entries in the `diagnostics` array of the scoring API response.

## Markdown support is undiscoverable

**Triggers when** your site serves markdown at `.md` URLs, but there is no agent-facing directive on HTML pages pointing to llms.txt and the server does not support content negotiation.

**What it means**: You've done the work to support markdown, but agents have no way to find out. They'll default to the HTML path every time. In observed agent behavior, agents do not independently discover `.md` URL variants; they need to be told.

**What to do**: Add a [directive](/checks/content-discoverability#llms-txt-directive-html) on your docs pages pointing to llms.txt, and implement [content negotiation](/checks/markdown-availability#content-negotiation) for `Accept: text/markdown`. The directive is the primary discovery mechanism because it reaches all agents; content negotiation provides a fast path for agents that request markdown by default. Both are recommended.

**Score impact**: Markdown quality checks (`page-size-markdown`, `markdown-code-fence-validity`, `markdown-content-parity`) are excluded from the score entirely when this diagnostic fires, because their results don't reflect real agent experience.

## Markdown support is only partially discoverable

**Triggers when** your site serves markdown at `.md` URLs and supports content negotiation, but there is no agent-facing directive on HTML pages pointing to llms.txt.

**What it means**: Agents that send `Accept: text/markdown` (Claude Code, Cursor, OpenCode) get markdown automatically, but the majority of agents fetch HTML by default and have no signal that a markdown path exists. Your markdown support benefits a subset of agents but not most of them.

**What to do**: Add a [directive](/checks/content-discoverability#llms-txt-directive-html) near the top of each HTML page pointing to your llms.txt. If your site serves markdown, mention that in the directive too. The directive reaches all agents, not just the ones that request markdown by default.

**Score impact**: Same as the undiscoverable case: markdown quality checks are excluded from the score because most agents still can't find the markdown path.

## Truncated index

**Triggers when** your llms.txt exists but exceeds agent context limits (the `llms-txt-size` check warns or fails).

**What it means**: Agents see roughly the first 50K–100K characters of your llms.txt. Everything beyond that point (links, structure, descriptions) is invisible to agents. Quality checks on the truncated portion are discounted in the score.

**What to do**: Split into a root llms.txt that links to section-level llms.txt files, each under 50,000 characters. The [llms-txt-size check](/checks/content-discoverability#llms-txt-size) details the thresholds.

**Score impact**: The index truncation coefficient scales down `llms-txt-links-resolve`, `llms-txt-valid`, `llms-txt-coverage`, and `llms-txt-links-markdown` proportionally. A file that's twice the limit counts those checks at roughly half weight.

## SPA shells invalidate HTML path

**Triggers when** more than 25% of sampled pages use client-side rendering (the `rendering-strategy` check warns or fails).

**What it means**: When humans visit the page in a browser, JavaScript loads the content. Agents don't visit a page in a browser, so they never see the content, only the shell. Page size and content structure scores for the HTML path are discounted because they're partially measuring shells, not actual content.

**What to do**: Enable server-side rendering or static generation for documentation pages. If only specific page templates use client-side content loading, target those templates. The [rendering-strategy check](/checks/page-size#rendering-strategy) explains how AFDocs detects SPA shells.

**Score impact**: The HTML path coefficient scales `page-size-html`, `content-start-position`, `tabbed-content-serialization`, and `section-header-quality` in proportion to the fraction of pages that render correctly. If 60% of pages are SPA shells, these checks count for 40% of their weight. At 50%+ SPA shells, the overall score is also [capped at D or F](/agent-score-calculation#score-caps).

## No viable path to content

**Triggers when** there's no working llms.txt (missing or nearly all links broken), no server-rendered HTML, and no discoverable markdown path.

**What it means**: Agents have no effective way to access your documentation. They will fall back on training data or secondary sources, both of which may be inaccurate or outdated.

**What to do**: If your site uses client-side rendering, enable server-side rendering. The second highest-impact action is creating an llms.txt at your site root with working links, ideally pointing to markdown pages. See [Improve Your Score](/improve-your-score) for a prioritized fix list.

**Score impact**: Caps the overall score at 39 (F).

## Auth-gated with no alternative

**Triggers when** all documentation requires authentication and no alternative access paths exist (the `auth-gate-detection` check fails and `auth-alternative-access` also fails).

**What it means**: Agents that encounter your docs will hit a login wall and fall back on training data or secondary sources.

**What to do**: Consider providing a public llms.txt with links to ungated content, removing auth gates from API references and integration guides, or shipping documentation with your SDK. The [auth-alternative-access check](/checks/authentication#auth-alternative-access) covers the options.

**Score impact**: Caps the overall score. If 75%+ of pages are gated with no alternatives, the cap is 39 (F). At 50%+, it's 59 (D).

## Pages exceed size limits with no markdown escape

**Triggers when** HTML pages exceed agent truncation limits and there's no discoverable markdown path that could offer smaller representations.

**What it means**: Agents will silently receive truncated content on oversized pages, with no alternative path to the full content. This is particularly common on sites that inline large amounts of CSS and JavaScript.

**What to do**: Either reduce HTML page sizes (break large pages into smaller ones, move inline CSS/JS to external files) or provide markdown versions and make them discoverable via content negotiation or llms.txt links. See [Page Size checks](/checks/page-size) for the specific thresholds.

**Score impact**: No direct score cap, but the combination of failing page-size checks with no markdown alternative typically results in low category scores for both Page Size and Markdown Availability.
