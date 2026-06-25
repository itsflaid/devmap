/**
 * fileRole.ts — classify files into architectural roles.
 *
 * Roles describe the STRUCTURAL PURPOSE of a file in a codebase,
 * not what library it uses or what domain it belongs to.
 *
 * Generic by design — roles here should apply to any web/backend/CLI project,
 * not just DevMap. DevMap-specific roles (snapshot-engine, analysis-engine)
 * have been removed and replaced with universal architectural roles.
 *
 * Role priority (checked top to bottom — first match wins):
 *   test → documentation → config → landing-ui → cli-command
 *   → api-handler → service → middleware → repository
 *   → ui-component → ai-integration → application-source
 */

export type FileRole =
  // --- Universal structural roles ---
  | "test"               // test files, specs, fixtures
  | "documentation"      // markdown, docs, changelogs
  | "config"             // config files, env, build setup
  | "landing-ui"         // public marketing / landing page UI
  | "cli-command"        // CLI entry points and command handlers
  | "api-handler"        // route handlers, controllers, API endpoints
  | "service"            // business logic, use cases, domain services
  | "middleware"         // middleware, guards, interceptors, proxies
  | "repository"         // data access layer, DAOs, query builders
  | "ui-component"       // React/Vue/Svelte/Astro UI components
  | "ai-integration"     // AI provider clients, prompt builders, LLM wrappers
  | "application-source"; // everything else — generic source file

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export function classifyFileRole(path: string): FileRole {
  const normalized = path.toLowerCase();
  const filename = normalized.split("/").at(-1) ?? normalized;
  const ext = filename.includes(".") ? "." + filename.split(".").at(-1) : "";

  // 1. Tests — check first, biar test helper files gak ke-classify sebagai source
  if (isTestPath(normalized)) return "test";

  // 2. Documentation
  if (isDocumentationPath(normalized, filename)) return "documentation";

  // 3. Config — build files, env, tsconfig, dll
  if (isConfigPath(normalized, filename, ext)) return "config";

  // 4. Landing UI — public marketing pages
  if (isLandingUIPath(normalized, filename, ext)) return "landing-ui";

  // 5. CLI commands — command handlers dan bin entry points
  if (isCLIPath(normalized)) return "cli-command";

  // 6. API handlers — route files, controllers, endpoint handlers
  if (isAPIHandlerPath(normalized, filename)) return "api-handler";

  // 7. Services — business logic layer
  if (isServicePath(normalized, filename)) return "service";

  // 8. Middleware — guards, interceptors, proxies
  if (isMiddlewarePath(normalized, filename)) return "middleware";

  // 9. Repository — data access layer
  if (isRepositoryPath(normalized, filename)) return "repository";

  // 10. UI components — React/Vue/Svelte components dan pages
  if (isUIComponentPath(normalized, filename, ext)) return "ui-component";

  // 11. AI integration — AI provider clients dan prompt builders
  if (isAIIntegrationPath(normalized, filename)) return "ai-integration";

  // 12. Fallback
  return "application-source";
}

// ---------------------------------------------------------------------------
// Role checkers
// ---------------------------------------------------------------------------

function isTestPath(path: string): boolean {
  return (
    /(^|\/)(__tests?__|fixtures?|tests?|mocks?|stubs?)(\/|$)/.test(path)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
    || /\.test\.(ts|js|tsx|jsx)$/.test(path)
    || /(^|\/)vitest\.setup\.[cm]?[jt]s$/.test(path)
    || /(^|\/)jest\.setup\.[cm]?[jt]s$/.test(path)
  );
}

function isDocumentationPath(path: string, filename: string): boolean {
  return (
    filename.endsWith(".md")
    || filename.endsWith(".mdx")
    || filename.endsWith(".txt")
    || /(^|\/)docs?(\/|$)/.test(path)
    || /(^|\/)changelog(s)?(\/|\.md$)/.test(path)
    || /(^|\/)contributing(\.md)?$/.test(path)
    || /(^|\/)license(\.md)?$/.test(path)
    || /(^|\/)readme(\.md)?$/.test(path)
    || /(^|\/)agents?\.md$/.test(path)
  );
}

function isConfigPath(path: string, filename: string, ext: string): boolean {
  // Named config files
  const CONFIG_FILENAMES = new Set([
    "package.json", "tsconfig.json", "tsconfig.base.json",
    ".eslintrc", ".eslintrc.json", ".eslintrc.js",
    ".prettierrc", ".prettierrc.json",
    "vite.config.ts", "vite.config.js",
    "next.config.ts", "next.config.js", "next.config.mjs",
    "tailwind.config.ts", "tailwind.config.js",
    "postcss.config.js", "postcss.config.ts",
    "drizzle.config.ts", "drizzle.config.js",
    "prisma.config.ts",
    "jest.config.ts", "jest.config.js",
    "vitest.config.ts", "vitest.config.js",
    "playwright.config.ts",
    "turbo.json", "pnpm-workspace.yaml",
    ".env", ".env.example", ".env.local",
    "dockerfile", "docker-compose.yml", "docker-compose.yaml",
  ]);

  if (CONFIG_FILENAMES.has(filename)) return true;

  return (
    // *.config.ts / *.config.js
    /\.(config)\.[cm]?[jt]sx?$/.test(filename)
    // src/config/ folder
    || /(^|\/)src\/configs?\/(\/|$)/.test(path)
    || /(^|\/)configs?\/(\/|$)/.test(path)
    // env files
    || /^\.env(\.|$)/.test(filename)
  );
}

function isLandingUIPath(path: string, filename: string, ext: string): boolean {
  const UI_EXTS = new Set([".astro", ".tsx", ".jsx", ".vue", ".svelte"]);
  if (!UI_EXTS.has(ext)) return false;

  return (
    /(^|\/)(landing|marketing)(\/|$)/.test(path)
    // Next.js / Astro home page
    || /(^|\/)src\/pages\/index\.(astro|tsx?|jsx?)$/.test(path)
    || /(^|\/)src\/app\/page\.(tsx?|jsx?)$/.test(path)
    // Named landing components
    || /(^|\/)+(hero|pricing|testimonials?|features?section|cta|banner|showcase)[^/]*\.(astro|tsx?|jsx?|vue|svelte)$/.test(path)
  );
}

function isCLIPath(path: string): boolean {
  return (
    /(^|\/)src\/commands?\/(\/|$)/.test(path)
    || /(^|\/)commands?\/(\/|$)/.test(path)
    || /(^|\/)bin\/(\/|$)/.test(path)
    // CLI entry point
    || /(^|\/)src\/cli\.[cm]?[jt]s$/.test(path)
    || /(^|\/)src\/main\.[cm]?[jt]s$/.test(path)
  );
}

function isAPIHandlerPath(path: string, filename: string): boolean {
  return (
    // Next.js App Router route files
    /\/app\/.*\/route\.[cm]?[jt]sx?$/.test(path)
    // Next.js Pages Router API
    || /\/pages\/api\//.test(path)
    // Express/Fastify/Hono router files
    || /(^|\/)src\/(routes?|routers?)(\/|$)/.test(path)
    || /(^|\/)routes?\/(\/|$)/.test(path)
    // Controllers (MVC pattern)
    || /(^|\/)src\/(controllers?)(\/|$)/.test(path)
    || /(^|\/)controllers?\/(\/|$)/.test(path)
    || /\.(controller)\.[cm]?[jt]sx?$/.test(filename)
    // Named handler files
    || /\.(handler|router)\.[cm]?[jt]sx?$/.test(filename)
  );
}

function isServicePath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/(services?|usecases?|use-cases?|domain|application)(\/|$)/.test(path)
    || /(^|\/)services?\/(\/|$)/.test(path)
    || /(^|\/)usecases?\/(\/|$)/.test(path)
    || /\.(service)\.[cm]?[jt]sx?$/.test(filename)
    || /\.(usecase|use-case)\.[cm]?[jt]sx?$/.test(filename)
    // Action files (Next.js server actions)
    || /(^|\/)src\/actions?\/(\/|$)/.test(path)
    || /\.(action)\.[cm]?[jt]sx?$/.test(filename)
  );
}

function isMiddlewarePath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/(middleware|middlewares?|guards?|interceptors?)(\/|$)/.test(path)
    || /(^|\/)middleware\.[cm]?[jt]sx?$/.test(path)
    || /(^|\/)proxy\.[cm]?[jt]sx?$/.test(path)
    || /\.(middleware|guard|interceptor)\.[cm]?[jt]sx?$/.test(filename)
    // Next.js middleware convention
    || /(^|\/)src\/middleware\.[cm]?[jt]sx?$/.test(path)
  );
}

function isRepositoryPath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/(repositories?|repos?|daos?|data-access)(\/|$)/.test(path)
    || /(^|\/)repositories?\/(\/|$)/.test(path)
    || /\.(repository|repo)\.[cm]?[jt]sx?$/.test(filename)
    // Prisma / DB client files
    || /(^|\/)src\/lib\/(prisma|db|database)\.[cm]?[jt]sx?$/.test(path)
    || /(^|\/)src\/(db|database)\/(\/|$)/.test(path)
    // Drizzle schema files
    || /(^|\/)src\/db\/schema\.[cm]?[jt]sx?$/.test(path)
  );
}

function isUIComponentPath(path: string, filename: string, ext: string): boolean {
  const UI_EXTS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".astro"]);
  if (!UI_EXTS.has(ext)) return false;

  // Exclude files already classified as api-handler, landing-ui, etc.
  // This runs last among UI checks so it acts as a broad catch-all for UI files.
  return (
    /(^|\/)src\/(components?|ui|widgets?)(\/|$)/.test(path)
    || /(^|\/)components?\/(\/|$)/.test(path)
    || /(^|\/)src\/(pages?|views?|screens?)(\/|$)/.test(path)
    || /(^|\/)pages?\/(\/|$)/.test(path)
    || /(^|\/)app\/.*\/(page|layout|loading|error|not-found)\.[cm]?[jt]sx?$/.test(path)
    // Catch-all: any .tsx/.jsx/.vue/.svelte not caught above
    || UI_EXTS.has(ext)
  );
}

function isAIIntegrationPath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/ai\/(\/|$)/.test(path)
    || /(^|\/)ai\/(\/|$)/.test(path)
    || /(^|\/)src\/lib\/(openai|groq|anthropic|gemini|langchain|ai)\.[cm]?[jt]sx?$/.test(path)
    || /(^|\/)src\/(llm|models?|prompts?)(\/|$)/.test(path)
    || /\.(prompt|chain)\.[cm]?[jt]sx?$/.test(filename)
  );
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

/**
 * isTechnicalFeatureSource — filter files yang relevan untuk feature detection.
 * Skip: test, documentation, config — mereka noise buat feature analysis.
 */
export function isTechnicalFeatureSource(path: string): boolean {
  const role = classifyFileRole(path);
  return role !== "test"
    && role !== "documentation"
    && role !== "config";
}

/**
 * isArchitecturalRole — roles yang represent meaningful architectural layers.
 * Berguna buat AI agent yang mau ngerti struktur project.
 */
export function isArchitecturalRole(role: FileRole): boolean {
  return (
    role === "api-handler"
    || role === "service"
    || role === "middleware"
    || role === "repository"
    || role === "ui-component"
    || role === "ai-integration"
    || role === "cli-command"
  );
}
