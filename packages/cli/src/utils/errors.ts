import { output } from "./output.js";

export class DevmapError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
    public readonly exitCode = 1
  ) {
    super(message);
    this.name = "DevmapError";
  }
}

export function handleError(error: unknown): number {
  if (error instanceof DevmapError) {
    output.error(error.message);
    if (error.hint) {
      output.note(`Tip: ${error.hint}`);
    }
    return error.exitCode;
  }

  if (isNodeError(error)) {
    if (error.code === "ENOENT") {
      output.error("The requested project path could not be found.");
      output.note("Tip: Check the path and run the command again.");
      return 1;
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
      output.error("DevMap does not have permission to access a required file.");
      output.note("Tip: Check folder permissions or run DevMap from a writable project directory.");
      return 1;
    }
  }

  if (error instanceof Error) {
    output.error("DevMap could not complete the command.");
    output.note(`Reason: ${error.message}`);
  } else {
    output.error("DevMap could not complete the command due to an unknown error.");
  }

  output.note("Tip: Run devmap doctor and include its output when reporting this issue.");
  return 1;
}

export async function runSafely(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    process.exitCode = handleError(error);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
