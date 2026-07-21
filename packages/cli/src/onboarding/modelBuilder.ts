import { REASON_TAGS } from "../analyzers/pipeline/reasonTags.js";
import type { ProjectMap } from "../analyzers/pipeline/index.js";
import type {
  OnboardingLanguage,
  OnboardingModel,
  ConceptualStep,
  FeatureSummary,
  StartHereItem,
} from "./model.js";

export function buildOnboardingModel(
  snapshot: ProjectMap,
  language: OnboardingLanguage
): OnboardingModel {
  return {
    language,
    projectName: snapshot.project.name || "project",
    tagline: buildTagline(snapshot, language),
    stackLine: buildStackLine(snapshot),
    whatThisIs: buildWhatThisIs(snapshot, language),
    howItWorks: buildHowItWorks(snapshot, language),
    features: buildFeatureSummaries(snapshot, language),
    startHere: buildStartHere(snapshot, language),
    generatedAt: snapshot.generatedAt,
    isStale: false,
  };
}

function buildTagline(snapshot: ProjectMap, language: OnboardingLanguage): string {
  if (snapshot.domain?.summary && snapshot.domain.summary.trim().length > 0) {
    const firstSentence = snapshot.domain.summary.split(/\.\s+/)[0];
    return firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`;
  }

  const ownershipHint = resolveOwnershipHint(snapshot, language);
  const primaryFeature = snapshot.features[0];

  if (ownershipHint && primaryFeature) {
    return language === "id"
      ? `${ownershipHint} dengan ${primaryFeature.name.toLowerCase()} sebagai fitur utama.`
      : `${ownershipHint} with ${primaryFeature.name.toLowerCase()} as the core feature.`;
  }

  if (primaryFeature && snapshot.project.framework !== "unknown") {
    return language === "id"
      ? `Aplikasi ${snapshot.project.framework} untuk ${primaryFeature.name.toLowerCase()}.`
      : `${snapshot.project.framework} app for ${primaryFeature.name.toLowerCase()}.`;
  }

  const fw = snapshot.project.framework !== "unknown" ? snapshot.project.framework : "application";
  return language === "id"
    ? `${snapshot.project.name || "Project"} — aplikasi ${fw}.`
    : `${snapshot.project.name || "Project"} — ${fw} application.`;
}

function resolveOwnershipHint(snapshot: ProjectMap, language: OnboardingLanguage): string | null {
  const caps = snapshot.capabilities ?? [];
  const hasSharing = caps.some((c) => c.kind === "sharing" || c.kind === "collaboration");
  const hasRealtime = caps.some((c) => c.kind === "real-time");
  const hasSocial = caps.some((c) => c.kind === "social");

  const domainPattern = (snapshot.domain as { ownershipPattern?: string })?.ownershipPattern;

  if (domainPattern === "single_user_isolated" || (!hasSharing && !hasRealtime && !hasSocial)) {
    return language === "id" ? "Aplikasi personal" : "Personal app";
  }

  if (domainPattern === "direct_messaging") {
    return language === "id" ? "Platform pesan langsung" : "Direct messaging platform";
  }

  if (hasSharing || hasRealtime || hasSocial) {
    return language === "id" ? "Aplikasi kolaborasi" : "Collaborative app";
  }

  return null;
}

function buildStackLine(snapshot: ProjectMap): string {
  const parts: string[] = [];

  if (snapshot.project.language && snapshot.project.language !== "unknown") {
    parts.push(capitalize(snapshot.project.language));
  }

  if (snapshot.project.framework && snapshot.project.framework !== "unknown") {
    parts.push(capitalize(snapshot.project.framework));
  }

  if (snapshot.database?.provider) {
    parts.push(capitalize(snapshot.database.provider));
  }

  for (const service of snapshot.externalServices.slice(0, 2)) {
    parts.push(capitalize(service));
  }

  return parts.slice(0, 5).join(" · ");
}

function buildWhatThisIs(snapshot: ProjectMap, language: OnboardingLanguage): string {
  const sentences: string[] = [];
  const name = snapshot.project.name || (language === "id" ? "Project ini" : "This project");
  const features = snapshot.features.map((f) => f.name);

  if (snapshot.ai?.architecture) {
    sentences.push(snapshot.ai.architecture);
  } else if (features.length > 0) {
    const topFeatures = features.slice(0, 3).map((f) => f.toLowerCase()).join(", ");
    sentences.push(
      language === "id"
        ? `${name} menangani ${topFeatures}.`
        : `${name} handles ${topFeatures}.`
    );
  }

  const domainPattern = (snapshot.domain as { ownershipPattern?: string })?.ownershipPattern;
  if (domainPattern === "single_user_isolated") {
    sentences.push(
      language === "id"
        ? "Semua data terisolasi per user — tidak ada fitur sharing atau kolaborasi antar akun."
        : "All data is user-isolated — there is no sharing or cross-account collaboration."
    );
  } else if (domainPattern === "shared_access") {
    sentences.push(
      language === "id"
        ? "Project ini mendukung akses bersama — beberapa user bisa berkolaborasi pada data yang sama."
        : "This project supports shared access — multiple users can collaborate on the same data."
    );
  }

  const entityNames = snapshot.entityGraph?.entityNames ?? [];
  const hasMisleadingChat = entityNames.includes("Message") && domainPattern === "single_user_isolated";
  if (hasMisleadingChat) {
    const roomEntity = entityNames.find((e) => e === "Room" || e === "Channel" || e === "Thread");
    if (roomEntity) {
      sentences.push(
        language === "id"
          ? `"${roomEntity}" adalah wadah (seperti folder), dan "Message" adalah isinya — bukan komunikasi antar user.`
          : `"${roomEntity}" acts as a container (like a folder), and "Message" is its content — not inter-user communication.`
      );
    }
  }

  if (snapshot.externalServices.length > 0) {
    const services = snapshot.externalServices.slice(0, 2).join(", ");
    sentences.push(
      language === "id"
        ? `Terhubung ke ${services}.`
        : `Integrates with ${services}.`
    );
  }

  return sentences.slice(0, 4).join(" ");
}

function buildHowItWorks(snapshot: ProjectMap, language: OnboardingLanguage): ConceptualStep[] {
  const hasAuth = snapshot.features.some((f) => f.name === "Authentication");
  const hasRoutes = snapshot.routes.length > 0 || snapshot.apiRoutes.length > 0;
  const hasDatabase = Boolean(snapshot.database);
  const isCli = snapshot.project.projectType === "node-cli"
    || Object.values(snapshot.fileIndex).some((e) => e.scope === "cli");
  const domainPattern = (snapshot.domain as { ownershipPattern?: string })?.ownershipPattern;

  if (isCli) {
    return buildCliFlow(snapshot, language);
  }

  if (hasAuth && hasRoutes) {
    return buildAuthWebAppFlow(snapshot, language, domainPattern, hasDatabase);
  }

  if (hasRoutes) {
    return buildPublicWebAppFlow(snapshot, language, hasDatabase);
  }

  return buildGenericFlow(snapshot, language);
}

function buildCliFlow(snapshot: ProjectMap, language: OnboardingLanguage): ConceptualStep[] {
  const commands = snapshot.features
    .filter((f) => f.name === "CLI Commands" || f.name.toLowerCase().includes("command"))
    .map((f) => f.name);

  if (language === "id") {
    return [
      { step: "User menjalankan command dari terminal." },
      { step: "CLI membaca konfigurasi dan menentukan proses yang dibutuhkan." },
      { step: commands.length > 0 ? `Command yang tersedia: ${commands.slice(0, 3).join(", ")}.` : "Command memproses input dan menghasilkan output." },
      { step: "Hasil disimpan atau ditampilkan sesuai flag yang diberikan." },
    ];
  }

  return [
    { step: "User runs a command from the terminal." },
    { step: "The CLI reads configuration and determines the required process." },
    { step: commands.length > 0 ? `Available commands include: ${commands.slice(0, 3).join(", ")}.` : "Commands process input and produce output." },
    { step: "Results are saved or displayed based on the given flags." },
  ];
}

function buildAuthWebAppFlow(
  snapshot: ProjectMap,
  language: OnboardingLanguage,
  ownershipPattern: string | undefined,
  hasDatabase: boolean
): ConceptualStep[] {
  const entities = snapshot.entityGraph?.entityNames
    .filter((e) => !["User", "Session", "Account", "VerificationToken"].includes(e))
    .slice(0, 2) ?? [];

  if (language === "id") {
    const steps: ConceptualStep[] = [
      { step: "User login — semua aksi butuh sesi aktif." },
    ];

    if (entities.length > 0) {
      steps.push({ step: `User membuat atau mengelola ${entities[0].toLowerCase()}${entities[1] ? ` yang berisi ${entities[1].toLowerCase()}` : ""}.` });
    }

    if (ownershipPattern === "single_user_isolated") {
      steps.push({ step: "Semua data milik user yang login — tidak ada akses lintas akun." });
    } else if (ownershipPattern === "shared_access") {
      steps.push({ step: "Data bisa diakses bersama antar user yang punya izin." });
    }

    if (hasDatabase) {
      steps.push({ step: "Perubahan data disimpan langsung ke database — tidak ada state sementara." });
    }

    steps.push({ step: "Response dikembalikan ke client — UI diperbarui sesuai hasil operasi." });

    return steps.slice(0, 5);
  }

  const steps: ConceptualStep[] = [
    { step: "User logs in — all actions require an active session." },
  ];

  if (entities.length > 0) {
    steps.push({ step: `User creates or manages ${entities[0].toLowerCase()}${entities[1] ? ` that contain ${entities[1].toLowerCase()}` : ""}.` });
  }

  if (ownershipPattern === "single_user_isolated") {
    steps.push({ step: "All data belongs to the logged-in user — no cross-account access." });
  } else if (ownershipPattern === "shared_access") {
    steps.push({ step: "Data can be shared across users with appropriate permissions." });
  }

  if (hasDatabase) {
    steps.push({ step: "Data changes are persisted directly to the database." });
  }

  steps.push({ step: "A response is returned to the client — UI updates to reflect the result." });

  return steps.slice(0, 5);
}

function buildPublicWebAppFlow(
  snapshot: ProjectMap,
  language: OnboardingLanguage,
  hasDatabase: boolean
): ConceptualStep[] {
  if (language === "id") {
    return [
      { step: "User membuka halaman atau mengirim request ke API." },
      { step: "Server memproses request dan menjalankan logic yang sesuai." },
      ...(hasDatabase ? [{ step: "Data dibaca dari atau ditulis ke database." }] : []),
      { step: "Response dikembalikan — halaman dirender atau data dikirim ke client." },
    ].slice(0, 5) as ConceptualStep[];
  }

  return [
    { step: "User opens a page or sends a request to the API." },
    { step: "The server processes the request and runs the relevant logic." },
    ...(hasDatabase ? [{ step: "Data is read from or written to the database." }] : []),
    { step: "A response is returned — the page renders or data is sent to the client." },
  ].slice(0, 5) as ConceptualStep[];
}

function buildGenericFlow(snapshot: ProjectMap, language: OnboardingLanguage): ConceptualStep[] {
  if (language === "id") {
    return [
      { step: "Program dimulai dari entry point utama." },
      { step: "Module dan dependency dimuat sesuai kebutuhan." },
      { step: "Logic utama dijalankan berdasarkan input atau konfigurasi." },
      { step: "Output dihasilkan sesuai tujuan program." },
    ];
  }

  return [
    { step: "The program starts from the main entry point." },
    { step: "Modules and dependencies are loaded as needed." },
    { step: "Core logic runs based on input or configuration." },
    { step: "Output is produced according to the program's purpose." },
  ];
}

function buildFeatureSummaries(
  snapshot: ProjectMap,
  language: OnboardingLanguage
): FeatureSummary[] {
  return snapshot.features.map((feature) => ({
    name: feature.name,
    what: buildFeatureWhat(feature, language),
    entryFile: feature.entryPoint ?? feature.entryPoints?.[0],
  }));
}

function buildFeatureWhat(
  feature: ProjectMap["features"][number],
  language: OnboardingLanguage
): string {
  if (feature.purpose && !isBoilerplatePurpose(feature.purpose)) {
    return feature.purpose.split(/\.\s+/)[0] + ".";
  }

  const name = feature.name.toLowerCase();
  if (language === "id") {
    return `Menangani ${name} dalam project.`;
  }
  return `Handles ${name} for the project.`;
}

function isBoilerplatePurpose(purpose: string): boolean {
  return /\b(exposes|contains project code|identifies .* capability|detected as)\b/i.test(purpose);
}

function buildStartHere(
  snapshot: ProjectMap,
  language: OnboardingLanguage
): StartHereItem[] {
  const items = new Map<string, StartHereItem>();
  let order = 1;

  const add = (path: string, reason: string) => {
    if (!path || items.has(path)) return;
    if (!isReadableSourceFile(path)) return;
    items.set(path, { path, reason, order: order++ });
  };

  const authFeature = snapshot.features.find((f) => f.name === "Authentication");
  if (authFeature?.entryPoint) {
    add(authFeature.entryPoint,
      language === "id"
        ? "Pahami siapa yang boleh akses apa sebelum membaca yang lain"
        : "Understand who can access what before reading anything else"
    );
  }

  const schemaFile = Object.keys(snapshot.fileIndex).find(
    (p) => /schema\.prisma$/.test(p)
  );
  if (schemaFile) {
    add(schemaFile,
      language === "id"
        ? "Pahami struktur data dan relasi antar entity"
        : "Understand the data model and entity relationships"
    );
  }

  for (const ep of snapshot.entryPoints.slice(0, 2)) {
    add(ep,
      language === "id"
        ? "Titik awal eksekusi — lihat command atau route yang tersedia"
        : "Execution entry point — see available commands or routes"
    );
  }

  const sortedFeatures = [...snapshot.features]
    .filter((f) => f.name !== "Authentication")
    .filter((f) => f.confidence === "high" || f.confidence === "medium")
    .slice(0, 5);

  for (const feature of sortedFeatures) {
    const ep = feature.entryPoint ?? feature.entryPoints?.[0];
    if (ep) {
      add(ep,
        language === "id"
          ? `Entry point untuk ${feature.name.toLowerCase()}`
          : `Entry point for ${feature.name.toLowerCase()}`
      );
    }
  }

  for (const critical of snapshot.criticalFiles.slice(0, 4)) {
    if (!items.has(critical.path)) {
      const reason = buildCriticalFileReason(critical, snapshot, language);
      add(critical.path, reason);
    }
  }

  for (const path of snapshot.onboarding.recommendedPath) {
    if (!items.has(path)) {
      add(path,
        language === "id"
          ? "File penting untuk memahami konteks project"
          : "Important file for understanding project context"
      );
    }
  }

  return Array.from(items.values());
}

function buildCriticalFileReason(
  critical: ProjectMap["criticalFiles"][number],
  snapshot: ProjectMap,
  language: OnboardingLanguage
): string {
  const reasons = critical.reasons;

  if (reasons.includes(REASON_TAGS.CORE_EXECUTION_RESPONSIBILITY)) {
    return language === "id"
      ? "File ini dijalankan pertama kali saat project start"
      : "This file runs first when the project starts";
  }
  if (reasons.includes(REASON_TAGS.CORE_PROJECT_CONCERN)) {
    return language === "id"
      ? "Concern inti project — banyak bagian lain bergantung ke sini"
      : "Core project concern — many other parts depend on this";
  }
  if (critical.referencedBy > 5) {
    return language === "id"
      ? `Diimport oleh ${critical.referencedBy} file lain — sangat central`
      : `Imported by ${critical.referencedBy} other files — highly central`;
  }

  return language === "id"
    ? "File penting berdasarkan struktur dependency project"
    : "Important file based on the project dependency structure";
}

function isReadableSourceFile(path: string): boolean {
  const lower = path.toLowerCase();
  return !(
    /\/(prisma\/)?migrations?\//.test(lower)
    || /\.sql$/.test(lower)
    || /\/generated\//.test(lower)
    || /\.generated\./.test(lower)
    || /\.(lock|log|map|d\.ts)$/.test(lower)
    || /\.(png|jpg|jpeg|gif|svg|ico|webp)$/.test(lower)
  );
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
