# Observability and Content Health

Whether agent-facing resources stay accurate over time. Getting `llms.txt` and markdown support working is the hard part; keeping them working is a different problem. These checks catch the silent failures: a stale index, drifting content between formats, and cache headers that delay updates.

## llms-txt-coverage

Whether your `llms.txt` reflects the current state of your documentation site.

|                |                                                                        |
| -------------- | ---------------------------------------------------------------------- |
| **Weight**     | Medium (4)                                                             |
| **Depends on** | `llms-txt-exists`                                                      |
| **Spec**       | [llms-txt-coverage](https://agentdocsspec.com/spec/#llms-txt-coverage) |

### Why it matters

An `llms.txt` that was accurate at launch but never updated is a silent failure. New pages won't appear in the index, deleted pages send agents to 404s, and renamed pages produce redirect chains. Unlike `llms-txt-links-resolve` (which catches broken links), this check catches missing coverage: pages that exist on your site but aren't listed in `llms.txt`.

### Results

Based on coverage of your site's documentation pages (excluding non-docs pages like blog posts, pricing, login):

| Result | Condition                                                       |
| ------ | --------------------------------------------------------------- |
| Pass   | `llms.txt` covers 95% or more of the site's documentation pages |
| Warn   | 80-95% coverage (some live pages missing from the index)        |
| Fail   | Under 80% coverage (missing large documentation sections)       |

### How to fix

**If this check warns or fails**, regenerate `llms.txt` from your sitemap or build pipeline. The best long-term fix is generating `llms.txt` at build time, so every deployment automatically includes an up-to-date index. Run with `--verbose` to see which pages are missing.

---

## markdown-content-parity

Whether markdown and HTML versions of pages contain the same content.

|                |                                                                                    |
| -------------- | ---------------------------------------------------------------------------------- |
| **Weight**     | Medium (4)                                                                         |
| **Depends on** | `markdown-url-support` or `content-negotiation`                                    |
| **Spec**       | [markdown-content-parity](https://agentdocsspec.com/spec/#markdown-content-parity) |

### Why it matters

When markdown is generated separately from HTML (not served directly from source), the two can drift. A site updates its HTML but forgets to regenerate the markdown, leaving agents with outdated instructions or code examples. Or a build pipeline that generates markdown misses some of the content. This is particularly insidious because agents receiving the markdown version have no signal that content is missing or outdated, and humans typically don't look at both page formats to spot discrepancies.

### Results

Based on the percentage of HTML content segments missing from the markdown version, after normalization:

| Result | Condition                                                                                     |
| ------ | --------------------------------------------------------------------------------------------- |
| Pass   | Under 5% of content segments missing                                                          |
| Warn   | 5-20% missing (minor differences like formatting or navigation elements)                      |
| Fail   | 20% or more missing (substantive differences like missing sections or outdated code examples) |

### How to fix

**If this check warns**, review the differences for formatting variations. Minor parity issues (navigation elements present in one format but not the other) may be acceptable.

**If this check fails**, your markdown and HTML versions have substantive content differences. Regenerate markdown from source, or fix the build pipeline to keep both formats in sync. The most reliable approach is serving markdown directly from the same source files used to generate HTML, rather than maintaining two separate outputs.

---

## cache-header-hygiene

Whether cache headers on `llms.txt` and markdown endpoints allow timely updates.

|            |                                                                              |
| ---------- | ---------------------------------------------------------------------------- |
| **Weight** | Low (2)                                                                      |
| **Spec**   | [cache-header-hygiene](https://agentdocsspec.com/spec/#cache-header-hygiene) |

### Why it matters

Aggressive caching means that after you update `llms.txt` or markdown content, agents and CDNs continue serving the stale version for hours or days. Conversely, missing cache headers lead to ambiguous behavior where CDN providers apply their own defaults.

This isn't only a CDN concern. Some agents appear to cache fetched content locally or through a server proxy, using cache headers to decide whether to re-fetch a page or serve a stored copy. In testing, agents have been observed returning stale content for pages they previously fetched, even after the source was updated. The exact mechanism varies by agent platform, but the practical effect is the same: long cache lifetimes delay how quickly agents see your changes.

For small, infrequently fetched resources like `llms.txt`, short cache lifetimes with revalidation headers are appropriate.

### Results

| Result | Condition                                                                                   |
| ------ | ------------------------------------------------------------------------------------------- |
| Pass   | `max-age` under 3600, or uses `must-revalidate` with `ETag`/`Last-Modified`                 |
| Warn   | Moderate caching (1-24 hours) that could delay updates                                      |
| Fail   | Aggressive caching (over 24 hours) with no revalidation, or no cache-related headers at all |

Responses that lack `Cache-Control`/`Expires` but include `ETag` or `Last-Modified` pass, because they enable conditional revalidation.

### How to fix

Set reasonable cache lifetimes on `.md` and `.txt` files. A `max-age` of 300-3600 seconds (5 minutes to 1 hour) with `must-revalidate` is a good default. Include `ETag` or `Last-Modified` headers so clients can conditionally revalidate without re-downloading unchanged content.
