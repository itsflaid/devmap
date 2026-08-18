import type { SignalDescriptor } from "./types.js";
import { DESCRIPTORS as authDescriptors } from "./auth.js";
import { DESCRIPTORS as paymentsDescriptors } from "./payments.js";
import { DESCRIPTORS as fileUploadDescriptors } from "./file-upload.js";
import { DESCRIPTORS as emailDescriptors } from "./email.js";
import { DESCRIPTORS as aiProviderDescriptors } from "./ai-providers.js";
import { DESCRIPTORS as notificationsDescriptors } from "./notifications.js";
import { DESCRIPTORS as cachingDescriptors } from "./caching.js";
import { DESCRIPTORS as searchDescriptors } from "./search.js";
import { DESCRIPTORS as backgroundJobsDescriptors } from "./background-jobs.js";
import { DESCRIPTORS as loggingMonitoringDescriptors } from "./logging-monitoring.js";
import { DESCRIPTORS as testingDescriptors } from "./testing.js";
import { DESCRIPTORS as internationalizationDescriptors } from "./internationalization.js";
import { DESCRIPTORS as analyticsDescriptors } from "./analytics.js";
import { DESCRIPTORS as rateLimitingDescriptors } from "./rate-limiting.js";
import { DESCRIPTORS as cmsContentDescriptors } from "./cms-content.js";
import { DESCRIPTORS as databaseDescriptors } from "./database.js";
import { DESCRIPTORS as firebaseDescriptors } from "./firebase.js";

export type { SignalDescriptor };

export const REGISTRY_DESCRIPTORS: SignalDescriptor[] = [
  ...authDescriptors,
  ...paymentsDescriptors,
  ...fileUploadDescriptors,
  ...emailDescriptors,
  ...aiProviderDescriptors,
  ...notificationsDescriptors,
  ...cachingDescriptors,
  ...searchDescriptors,
  ...backgroundJobsDescriptors,
  ...loggingMonitoringDescriptors,
  ...testingDescriptors,
  ...internationalizationDescriptors,
  ...analyticsDescriptors,
  ...rateLimitingDescriptors,
  ...cmsContentDescriptors,
  ...databaseDescriptors,
  ...firebaseDescriptors,
];

const descriptorByName = new Map(REGISTRY_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]));

export type FeatureSignal = {
  name: string;
  terms: string[];
  purpose: string;
  importOnly?: true;
  minimumDistinctFiles?: number;
};

export const FEATURE_SIGNALS: FeatureSignal[] = REGISTRY_DESCRIPTORS
  .filter((descriptor) => descriptor.category === "feature")
  .map((descriptor) => ({
    name: descriptor.name,
    terms: descriptor.genericTerms ?? [],
    purpose: descriptor.purpose ?? `Identifies ${descriptor.name.toLowerCase()} capability in the project.`,
    ...(descriptor.importOnly ? { importOnly: true } : {}),
    ...(descriptor.minimumDistinctFiles !== undefined
      ? { minimumDistinctFiles: descriptor.minimumDistinctFiles }
      : {}),
  }));

const SERVICE_NAMES = [
  "Prisma", "Supabase", "Stripe", "NextAuth", "Midtrans", "Resend",
  "Cloudinary", "Firebase", "OpenAI", "Groq", "OpenRouter",
] as const;

function requireProviderDescriptor(name: string): SignalDescriptor {
  const descriptor = descriptorByName.get(name);
  if (!descriptor || !descriptor.importNames?.length) {
    throw new Error(`registry: missing provider descriptor for service "${name}"`);
  }
  return descriptor;
}

export const SERVICES: Array<[string[], string]> = SERVICE_NAMES.map((name) => {
  const descriptor = requireProviderDescriptor(name);
  return [descriptor.importNames!, name];
});

export const SOURCE_SERVICE_SIGNALS: Array<[string[], string]> = SERVICE_NAMES.flatMap((name) => {
  const signals = descriptorByName.get(name)?.contentSignals;
  return signals?.length ? [[signals, name] as [string[], string]] : [];
});

const aiProviders = REGISTRY_DESCRIPTORS.filter((descriptor) => descriptor.category === "ai-provider");
const AI_PROVIDER_IMPORTS = new Set(aiProviders.flatMap((descriptor) => descriptor.importNames ?? []));
const AI_PROVIDER_PREFIXES = [
  ...new Set(aiProviders.flatMap((descriptor) => descriptor.importPrefixes ?? [])),
];
const AI_PROVIDER_HOSTS = [
  ...new Set(aiProviders.flatMap((descriptor) => descriptor.hosts ?? [])),
];

export function isAiProviderImport(specifier: string): boolean {
  const lower = specifier.toLowerCase();
  if (AI_PROVIDER_IMPORTS.has(lower)) return true;
  return AI_PROVIDER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function hasAiProviderUrl(content: string | undefined): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return AI_PROVIDER_HOSTS.some((host) => lower.includes(host));
}