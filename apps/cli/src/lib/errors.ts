export function formatError(error: unknown): string {
  if (error instanceof Error) {
    // viem's BaseError extends Error and has shortMessage
    const asAny = error as Error & { shortMessage?: string };
    return asAny.shortMessage ?? error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }

  return "Unknown error";
}

export function handleCommandError(error: unknown) {
  const message = formatError(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
