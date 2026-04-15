# CLI Reference

## Install

```bash
# Run without installing (recommended for getting started)
npx afdocs check https://docs.example.com

# Install globally
npm install -g afdocs

# Install as a project dev dependency
npm install -D afdocs
```

Requires Node.js 22 or later.

## Commands

### `afdocs check <url>`

Run agent-friendly documentation checks against a URL.

```bash
afdocs check https://docs.example.com
```

The URL can be a site root or a specific page. When pointing to a site root, `afdocs` discovers pages via `llms.txt` and sitemap, then samples a subset to check. When pointing to a specific page with `--sampling none`, it skips discovery and checks just that page.

## Options

### Output

| Flag                    | Default | Description                                                                                                                                      |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-f, --format <format>` | `text`  | Output format: `text`, `json`, or `scorecard`                                                                                                    |
| `-v, --verbose`         |         | Show per-page details for checks with issues                                                                                                     |
| `--fixes`               |         | Show per-check fix suggestions for warn/fail checks (only needed for `text` format; the other two formats include fix suggestions automatically) |
| `--score`               |         | Include scoring data in JSON output (only usable with `json` output format)                                                                      |

**Which format to use:**

- **`text`** is the default. Shows per-check pass/warn/fail/skip results. Add `--verbose` for per-page details and `--fixes` for fix suggestions. Useful when iterating on individual check fixes.
- **`scorecard`** includes the overall score, per-category scores, interaction diagnostics, and fix suggestions for every failing check. This is the best starting point for understanding your site's agent-friendliness.
- **`json`** produces machine-readable output for scripting and automation. Add `--score` to include scoring data and fix suggestions.

### Config file

| Flag              | Default | Description                                  |
| ----------------- | ------- | -------------------------------------------- |
| `--config <path>` |         | Path to a config file (skips auto-discovery) |

Without `--config`, the CLI looks for `agent-docs.config.yml` (or `.yaml`) starting from the current directory and walking up the tree. Config values serve as defaults; any CLI flags you pass override them.

```bash
# Auto-discover config (typical usage)
afdocs check --format scorecard

# Use an explicit config file
afdocs check --config agent-docs.local.yml --format scorecard
```

See [Config File](/reference/config-file) for the full config format.

### Check selection

| Flag                 | Default | Description                              |
| -------------------- | ------- | ---------------------------------------- |
| `-c, --checks <ids>` | all     | Comma-separated list of check IDs to run |

```bash
# Run only llms.txt checks
afdocs check https://docs.example.com --checks llms-txt-exists,llms-txt-valid,llms-txt-size
```

Some checks depend on others. If you include a check without its dependency, the dependent check will be skipped. See [Check dependencies](/checks/#check-dependencies) for the full list.

### Sampling

| Flag                    | Default  | Description                                                                  |
| ----------------------- | -------- | ---------------------------------------------------------------------------- |
| `--sampling <strategy>` | `random` | URL sampling strategy: `random`, `deterministic`, `curated`, or `none`       |
| `--max-links <n>`       | `50`     | Maximum number of pages to sample                                            |
| `--urls <urls>`         |          | Comma-separated page URLs for curated scoring (implies `--sampling curated`) |

**Sampling strategies:**

- **`random`**: Shuffle discovered URLs and take the first N. Fast and broad, but results vary between runs. Useful for spot-checking pages across a large corpus.
- **`deterministic`**: Sort discovered URLs alphabetically and pick an even spread. Produces the same sample on repeated runs as long as the URL set is stable. Useful for CI or when verifying a fix.
- **`curated`**: Test a specific set of pages listed in the config file's `pages` field or passed via `--urls`. Skips discovery entirely. Useful for ongoing monitoring of representative pages or focused evaluation of specific sections.
- **`none`**: Skip discovery entirely. Only check the URL you pass on the command line.

```bash
# Reproducible results
afdocs check https://docs.example.com --sampling deterministic

# Check a single page
afdocs check https://docs.example.com/api/auth --sampling none

# Test specific pages without a config file
afdocs check https://docs.example.com --urls https://docs.example.com/quickstart,https://docs.example.com/api/auth

# Sample fewer pages for a quicker run
afdocs check https://docs.example.com --max-links 10

# Sample more pages for better representation across a large corpus
afdocs check https://docs.example.com --max-links 100
```

### URL discovery

| Flag                      | Default     | Description                                                      |
| ------------------------- | ----------- | ---------------------------------------------------------------- |
| `--doc-locale <code>`     | auto-detect | Preferred locale for URL discovery (e.g. `en`, `fr`, `ja`)       |
| `--doc-version <version>` | auto-detect | Preferred version for URL discovery (e.g. `v3`, `2.x`, `latest`) |

When `afdocs` discovers pages from a sitemap or `llms.txt`, it automatically filters out duplicate locale and version variants so you get a representative sample of unique content.

The resolution order for both flags is:

1. **Explicit flag** (`--doc-locale`, `--doc-version`) if provided
2. **Auto-detect** from the base URL path (e.g. `https://docs.example.com/fr/v3` detects `fr` and `v3`)
3. **Built-in fallback** when neither of the above yields a value: locale falls back to `en`; version prefers unversioned URLs, then `latest`/`stable`/`current`, then the highest semver. Pre-release channels (`dev`, `next`, `nightly`, `canary`) are ranked below stable versions

Use the flags when the base URL doesn't contain locale or version segments but the site organizes content by locale or version.

```bash
# Prefer French locale during discovery
afdocs check https://docs.example.com --doc-locale fr

# Prefer a specific version
afdocs check https://docs.example.com --doc-version v3

# Both together
afdocs check https://docs.example.com --doc-locale ja --doc-version 2.x
```

### Request behavior

| Flag                    | Default | Description                            |
| ----------------------- | ------- | -------------------------------------- |
| `--max-concurrency <n>` | `3`     | Maximum concurrent HTTP requests       |
| `--request-delay <ms>`  | `200`   | Delay between requests in milliseconds |

AFDocs enforces delays between requests and caps concurrent connections to avoid overloading your server. Adjust these if you need gentler or faster runs:

```bash
# Slower, gentler (for rate-limited servers)
afdocs check https://docs.example.com --request-delay 500 --max-concurrency 1

# Faster (for your own infrastructure)
afdocs check https://docs.example.com --request-delay 50 --max-concurrency 10
```

### Size thresholds

| Flag                   | Default  | Description                            |
| ---------------------- | -------- | -------------------------------------- |
| `--pass-threshold <n>` | `50000`  | Page size pass threshold in characters |
| `--fail-threshold <n>` | `100000` | Page size fail threshold in characters |

These thresholds apply to `page-size-html`, `page-size-markdown`, and `tabbed-content-serialization`. Pages under the pass threshold pass; pages between the two thresholds warn; pages over the fail threshold fail.

The defaults (50K pass, 100K fail) reflect observed agent truncation limits. You generally don't need to change these unless you have specific knowledge of your users' agent platforms.

## Exit codes

| Code | Meaning                     |
| ---- | --------------------------- |
| `0`  | All checks passed or warned |
| `1`  | One or more checks failed   |

This makes AFDocs usable in CI pipelines and shell scripts. A warning does not cause a non-zero exit. See [CI Integration](/ci-integration) for full setup.

## Global flags

| Flag        | Description              |
| ----------- | ------------------------ |
| `--version` | Print the version number |
| `--help`    | Print help information   |
