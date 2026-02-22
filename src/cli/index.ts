import { Command } from 'commander';
import { registerCheckCommand } from './commands/check.js';

export function run(argv: string[]): void {
  const program = new Command();

  program
    .name('afdocs')
    .description('Test your documentation site against the Agent-Friendly Documentation Spec')
    .version('0.1.0');

  registerCheckCommand(program);

  program.parse(argv);
}
