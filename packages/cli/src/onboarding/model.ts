export type OnboardingLanguage = "en" | "id";

export interface StartHereItem {
  path: string;
  reason: string;
  order: number;
}

export interface FeatureSummary {
  name: string;
  what: string;
  entryFile?: string;
}

export interface ConceptualStep {
  step: string;
}

export interface OnboardingModel {
  language: OnboardingLanguage;

  projectName: string;
  tagline: string;
  stackLine: string;

  whatThisIs: string;
  howItWorks: ConceptualStep[];
  features: FeatureSummary[];
  startHere: StartHereItem[];

  generatedAt: string;
  isStale: boolean;
}
