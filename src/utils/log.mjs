import chalk from 'chalk';

export const log = {
  info:    (msg) => console.log(chalk.dim('  ') + msg),
  success: (msg) => console.log(chalk.green('✓ ') + msg),
  warn:    (msg) => console.log(chalk.yellow('⚠ ') + msg),
  error:   (msg) => console.error(chalk.red('✗ ') + msg),
  debug:   (msg) => process.env.AQUACLAW_DEBUG && console.log(chalk.gray('[debug] ') + msg),
};
