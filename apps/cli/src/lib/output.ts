import chalk from "chalk";

export type OutputFormat = "json" | "table";

export function printJson(data: unknown) {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(rows: Record<string, unknown>[]) {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.table(rows);
}

export function printSuccess(message: string) {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(chalk.green(message));
}

export function printWarning(message: string) {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(chalk.yellow(message));
}

export function printError(message: string) {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.error(chalk.red(message));
}
