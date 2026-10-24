export type SignalCategory = "feature" | "provider" | "ai-provider";

export type SignalDescriptor = {
  name: string;
  category: SignalCategory;
  purpose?: string;
  /** Terms matched against file paths and import specifiers. */
  genericTerms?: string[];
  /** Terms matched only against package imports (never paths or relative imports). */
  importTerms?: string[];
  /** Regex sources; a file whose path matches one never counts as evidence for this signal. */
  excludePaths?: string[];
  importNames?: string[];
  importPrefixes?: string[];
  contentSignals?: string[];
  hosts?: string[];
  importOnly?: true;
  minimumDistinctFiles?: number;
};