# afdocs CI Example

This directory contains everything you need to add agent-friendliness checks to your documentation site's CI pipeline using [afdocs](https://www.npmjs.com/package/afdocs).

## Files

| File                               | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `package.json`                     | Declares afdocs and vitest as dev dependencies                    |
| `agent-docs.config.yml`            | Points afdocs at your site URL and configures which checks to run |
| `agent-docs.test.ts`               | Test file that runs the checks (3 lines)                          |
| `.gitignore`                       | Excludes `node_modules/` from version control                     |
| `.github/workflows/agent-docs.yml` | GitHub Actions workflow to run checks on push and PR              |

## Setup

1. Copy these files into your project root:

   ```bash
   cp package.json agent-docs.config.yml agent-docs.test.ts .gitignore /path/to/your/project/
   cp -r .github /path/to/your/project/
   ```

   If your project already has a `package.json`, merge the `devDependencies` and `scripts` instead of overwriting it. If you already have a `.gitignore`, just make sure `node_modules/` is listed.

2. Edit `agent-docs.config.yml` and replace the URL with your documentation site:

   ```yaml
   url: https://docs.yoursite.com
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Run the checks locally to verify everything works:

   ```bash
   npm run test:agent-docs
   ```

   You should see one test per check, each showing pass, warn, fail, or skip.

5. Commit the files and push. The GitHub Actions workflow will run the checks automatically on every push and pull request to `main`.

## Running a subset of checks

If some checks don't apply to your site (for example, you don't serve markdown), you can limit which checks run by adding a `checks` list to `agent-docs.config.yml`:

```yaml
url: https://docs.yoursite.com
checks:
  - llms-txt-exists
  - llms-txt-valid
  - llms-txt-size
  - http-status-codes
  - auth-gate-detection
```

Checks not in the list will show as skipped in the test output. See the main [afdocs README](https://github.com/agent-ecosystem/afdocs#checks) for the full list of available checks.

## Organizing files

If you'd prefer to keep the test files out of your project root, you can move `agent-docs.config.yml` and `agent-docs.test.ts` into a subdirectory (e.g., `tests/`). Update the test script in `package.json` to match:

```json
{
  "scripts": {
    "test:agent-docs": "vitest run tests/agent-docs.test.ts"
  }
}
```

Then update the test file to tell afdocs where to find the config:

```ts
import { describeAgentDocsPerCheck } from 'afdocs/helpers';

describeAgentDocsPerCheck(__dirname);
```

## Other CI providers

The `.github/workflows/agent-docs.yml` file is for GitHub Actions. For other CI providers, the steps are the same: install Node.js, run `npm install`, then run `npm run test:agent-docs`. The test exits with code 0 if all checks pass (or warn) and code 1 if any check fails.
