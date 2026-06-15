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

export function handleError(error: unknown, json = false): number {
  if (json) {
    const normalized = normalizeError(error);
    output.json({
      status: "error",
      error: normalized.message,
      hint: normalized.hint ?? null
    });
    return normalized.exitCode;
  }

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
    process.exitCode = handleError(error, process.argv.includes("--json"));
  }
}

function normalizeError(error: unknown): {
  message: string;
  hint?: string;
  exitCode: number;
} {
  if (error instanceof DevmapError) {
    return {
      message: error.message,
      hint: error.hint,
      exitCode: error.exitCode
    };
  }

  if (isNodeError(error) && error.code === "ENOENT") {
    return {
      message: "The requested project path could not be found.",
      hint: "Check the path and run the command again.",
      exitCode: 1
    };
  }

  if (isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM")) {
    return {
      message: "DevMap does not have permission to access a required file.",
      hint: "Check folder permissions or run DevMap from a writable project directory.",
      exitCode: 1
    };
  }

  return {
    message: error instanceof Error
      ? error.message
      : "DevMap could not complete the command due to an unknown error.",
    hint: "Run devmap doctor --json and include its output when reporting this issue.",
    exitCode: 1
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
