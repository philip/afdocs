# Config File

The `agent-docs.config.yml` file lets you define a reusable configuration for running `afdocs` checks. It's currently used by the [vitest test helpers](/ci-integration) and is planned for CLI support ([issue #12](https://github.com/agent-ecosystem/afdocs/issues/12)).

## Format

```yaml
# Required: the URL to check
url: https://docs.example.com

# Optional: run only specific checks
checks:
  - llms-txt-exists
  - llms-txt-valid
  - llms-txt-size
  - llms-txt-links-resolve
  - rendering-strategy
  - page-size-html
  - http-status-codes
  - auth-gate-detection

# Optional: override default options
options:
  maxLinksToTest: 20
  samplingStrategy: deterministic
  maxConcurrency: 5
  requestDelay: 100
  thresholds:
    pass: 50000
    fail: 100000
```

## Fields

### `url` (required)

The documentation site URL to check. This is the only required field.

### `checks` (optional)

A list of check IDs to run. If omitted, all 22 checks run. Use this to focus on checks that are actionable for your platform. See the [Checks Reference](/checks/) for the full list of check IDs.

This is particularly useful when your docs platform doesn't support certain capabilities. For example, if you can't serve markdown, exclude the markdown-related checks so your score reflects what you can control. See [Improve Your Score](/improve-your-score#step-3-work-through-fixes-iteratively) for more on this approach.

### `options` (optional)

Override default runner options. All fields are optional:

| Field              | Default  | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `maxLinksToTest`   | `50`     | Maximum number of pages to sample                    |
| `samplingStrategy` | `random` | `random`, `deterministic`, or `none`                 |
| `maxConcurrency`   | `3`      | Maximum concurrent HTTP requests                     |
| `requestDelay`     | `200`    | Delay between requests in milliseconds               |
| `requestTimeout`   | `30000`  | Timeout for individual HTTP requests in milliseconds |
| `thresholds.pass`  | `50000`  | Page size pass threshold in characters               |
| `thresholds.fail`  | `100000` | Page size fail threshold in characters               |

## Config resolution

The config loader searches for `agent-docs.config.yml` (or `.yaml`) starting from the current working directory and walking up the directory tree, similar to how ESLint and Prettier find their config files. This means the config works whether your test file is at the project root or in a subdirectory.

You can also pass an explicit directory to the vitest helpers:

```ts
import { describeAgentDocsPerCheck } from 'afdocs/helpers';

describeAgentDocsPerCheck(__dirname);
```

## Multiple configs

You might maintain separate configs for different contexts (local development, staging, production). Once CLI config support lands ([issue #12](https://github.com/agent-ecosystem/afdocs/issues/12)), you'll be able to select a config at runtime:

```bash
# Planned CLI usage
afdocs check --config agent-docs.local.yml
afdocs check --config agent-docs.staging.yml
```

For now, the vitest helpers always use the auto-discovered `agent-docs.config.yml`. If you need different configs for different environments, use environment variables or conditional logic in your test file to pass different options to the helpers.
