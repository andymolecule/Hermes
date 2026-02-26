import chalk from "chalk";

export type OutputFormat = "json" | "table";

export function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(rows: Record<string, unknown>[]) {
  console.table(rows);
}

export function printSuccess(message: string) {
  console.log(chalk.green(message));
}

export function printWarning(message: string) {
  console.log(chalk.yellow(message));
}

export function printError(message: string) {
  console.error(chalk.red(message));
}
