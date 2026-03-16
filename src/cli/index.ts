import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerCheckCommand } from './commands/check.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

export function run(argv: string[]): void {
  const program = new Command();

  program
    .name('afdocs')
    .description('Test your documentation site against the Agent-Friendly Documentation Spec')
    .version(version);

  registerCheckCommand(program);

  program.parse(argv);
}
