export type OnboardingLanguage = "en" | "id";

export interface ReadingItem {
  path: string;
  priority: 1 | 2 | 3 | 4;
  purpose: string;
  why: string;
}

export interface FlowStep {
  label: string;
  purpose?: string;
}

export interface FlowBlock {
  name: string;
  type: string;
  entryPoint: string | null;
  steps: FlowStep[];
}

export interface OnboardingModel {
  language: OnboardingLanguage;

  project: {
    name: string;
    language: string | null;
    framework: string | null;
    packageManager: string | null;
  };

  overview: string;
  mentalModel: string[];
  mainConcepts: string[];
  importantAreas: ReadingItem[];
  keyFlows: FlowBlock[];
  whereToStart: string[];
  generatedBy: string;
}
