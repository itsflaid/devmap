export type SignalCategory = "feature" | "provider" | "ai-provider";

export type SignalDescriptor = {
  name: string;
  category: SignalCategory;
  purpose?: string;
  genericTerms?: string[];
  importNames?: string[];
  importPrefixes?: string[];
  contentSignals?: string[];
  hosts?: string[];
  importOnly?: true;
  minimumDistinctFiles?: number;
};