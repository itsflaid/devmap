/**
 * A role is a file's structural purpose, not the library it uses or its domain. The roles are
 * generic so they fit any web, backend or CLI project. `classifyFileRole` returns the first match
 * in declaration order, except that `config` is checked before `landing-ui`.
 */
export type FileRole =
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

export function classifyFileRole(path: string): FileRole {
  const normalized = path.toLowerCase();
  const filename = normalized.split("/").at(-1) ?? normalized;
  const ext = filename.includes(".") ? "." + filename.split(".").at(-1) : "";

  // Tests go first so test helpers are not classified as source.
  if (isTestPath(normalized)) return "test";
  if (isDocumentationPath(normalized, filename)) return "documentation";
  if (isConfigPath(normalized, filename, ext)) return "config";
  if (isLandingUIPath(normalized, filename, ext)) return "landing-ui";
  if (isCLIPath(normalized)) return "cli-command";
  if (isAPIHandlerPath(normalized, filename)) return "api-handler";
  if (isServicePath(normalized, filename)) return "service";
  if (isMiddlewarePath(normalized, filename)) return "middleware";
  if (isRepositoryPath(normalized, filename)) return "repository";
  if (isUIComponentPath(normalized, filename, ext)) return "ui-component";
  if (isAIIntegrationPath(normalized, filename)) return "ai-integration";

  return "application-source";
}

function isTestPath(path: string): boolean {
  return (
    /(^|\/)(__tests?__|fixtures?|tests?|mocks?|stubs?)(\/|$)/.test(path)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
    || /\.test\.(ts|js|tsx|jsx)$/.test(path)
    || /(^|\/)vitest\.setup\.[cm]?[jt]s$/.test(path)
    || /(^|\/)jest\.setup\.[cm]?[jt]s$/.test(path)
  );
}

// Repo boilerplate, DevMap meta and GitHub management files. They keep the "documentation" role (so
// isTechnicalFeatureSource skips them) but are not evidence for the Documentation feature.
const DOCUMENTATION_META_FILENAMES = new Set([
  "devmap.md", "agents.md",
  "contributing.md", "code_of_conduct.md", "code-of-conduct.md",
  "security.md", "license.md", "licence.md", "changelog.md",
  "pull_request_template.md", "issue_template.md", "codeowners",
]);

function isDocumentationPath(path: string, filename: string): boolean {
  // Deliberately broad (every .md, .mdx, .txt) because isTechnicalFeatureSource uses the role to
  // skip docs; featureDetector narrows it with isDocumentationEvidence().
  return (
    filename.endsWith(".md")
    || filename.endsWith(".mdx")
    || filename.endsWith(".txt")
    || /(^|\/)docs?(\/|$)/.test(path)
    || /(^|\/)wiki(\/|$)/.test(path)
    || /(^|\/)changelog(s)?(\/|\.md$)/.test(path)
    || /(^|\/)contributing(\.md)?$/.test(path)
    || /(^|\/)license(\.md)?$/.test(path)
    || /(^|\/)readme(\.md)?$/.test(path)
    || /(^|\/)agents?\.md$/.test(path)
    || /(openapi|swagger)\.(json|yaml|yml)$/.test(filename)
  );
}

/** Whether a lowercase file name is a repo meta-file that is not documentation evidence. */
export function isDocumentationMeta(filename: string): boolean {
  return DOCUMENTATION_META_FILENAMES.has(filename.toLowerCase());
}

function isConfigPath(path: string, filename: string, ext: string): boolean {
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
    /\.(config)\.[cm]?[jt]sx?$/.test(filename)
    || /(^|\/)src\/configs?(\/|$)/.test(path)
    || /(^|\/)configs?(\/|$)/.test(path)
    || /^\.env(\.|$)/.test(filename)
  );
}

function isLandingUIPath(path: string, filename: string, ext: string): boolean {
  const UI_EXTS = new Set([".astro", ".tsx", ".jsx", ".vue", ".svelte"]);
  if (!UI_EXTS.has(ext)) return false;

  return (
    /(^|\/)(landing|marketing)(\/|$)/.test(path)
    || /(^|\/)src\/pages\/index\.(astro|tsx?|jsx?)$/.test(path)
    || /(^|\/)src\/app\/page\.(tsx?|jsx?)$/.test(path)
    || /(^|\/)+(hero|pricing|testimonials?|features?section|cta|banner|showcase)[^/]*\.(astro|tsx?|jsx?|vue|svelte)$/.test(path)
  );
}

function isCLIPath(path: string): boolean {
  return (
    /(^|\/)src\/commands?(\/|$)/.test(path)
    || /(^|\/)commands?(\/|$)/.test(path)
    || /(^|\/)bin(\/|$)/.test(path)
    || /(^|\/)src\/cli\.[cm]?[jt]s$/.test(path)
    || /(^|\/)src\/main\.[cm]?[jt]s$/.test(path)
  );
}

function isAPIHandlerPath(path: string, filename: string): boolean {
  return (
    /\/app\/.*\/route\.[cm]?[jt]sx?$/.test(path)
    || /\/pages\/api\//.test(path)
    || /(^|\/)src\/(routes?|routers?)(\/|$)/.test(path)
    || /(^|\/)routes?(\/|$)/.test(path)
    || /(^|\/)src\/(controllers?)(\/|$)/.test(path)
    || /(^|\/)controllers?(\/|$)/.test(path)
    || /\.(controller)\.[cm]?[jt]sx?$/.test(filename)
    || /\.(handler|router)\.[cm]?[jt]sx?$/.test(filename)
  );
}

function isServicePath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/(services?|usecases?|use-cases?|domain|application)(\/|$)/.test(path)
    || /(^|\/)services?(\/|$)/.test(path)
    || /(^|\/)usecases?(\/|$)/.test(path)
    || /\.(service)\.[cm]?[jt]sx?$/.test(filename)
    || /\.(usecase|use-case)\.[cm]?[jt]sx?$/.test(filename)
    || /(^|\/)src\/actions?(\/|$)/.test(path)
    || /\.(action)\.[cm]?[jt]sx?$/.test(filename)
  );
}

function isMiddlewarePath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/(middleware|middlewares?|guards?|interceptors?)(\/|$)/.test(path)
    || /(^|\/)middleware\.[cm]?[jt]sx?$/.test(path)
    || /(^|\/)proxy\.[cm]?[jt]sx?$/.test(path)
    || /\.(middleware|guard|interceptor)\.[cm]?[jt]sx?$/.test(filename)
    || /(^|\/)src\/middleware\.[cm]?[jt]sx?$/.test(path)
  );
}

function isRepositoryPath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/(repositories?|repos?|daos?|data-access)(\/|$)/.test(path)
    || /(^|\/)repositories?(\/|$)/.test(path)
    || /\.(repository|repo)\.[cm]?[jt]sx?$/.test(filename)
    || /(^|\/)src\/lib\/(prisma|db|database)\.[cm]?[jt]sx?$/.test(path)
    || /(^|\/)src\/(db|database)(\/|$)/.test(path)
    || /(^|\/)src\/db\/schema\.[cm]?[jt]sx?$/.test(path)
  );
}

function isUIComponentPath(path: string, filename: string, ext: string): boolean {
  const UI_EXTS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".astro"]);
  if (!UI_EXTS.has(ext)) return false;

  return (
    /(^|\/)src\/(components?|ui|widgets?)(\/|$)/.test(path)
    || /(^|\/)components?(\/|$)/.test(path)
    || /(^|\/)src\/(pages?|views?|screens?)(\/|$)/.test(path)
    || /(^|\/)pages?(\/|$)/.test(path)
    || /(^|\/)app\/.*\/(page|layout|loading|error|not-found)\.[cm]?[jt]sx?$/.test(path)
    // The earlier patterns are subsumed by this: any UI-extension file that no earlier role took.
    || UI_EXTS.has(ext)
  );
}

function isAIIntegrationPath(path: string, filename: string): boolean {
  return (
    /(^|\/)src\/ai(\/|$)/.test(path)
    || /(^|\/)ai(\/|$)/.test(path)
    || /(^|\/)src\/lib\/(openai|groq|anthropic|gemini|langchain|ai)\.[cm]?[jt]sx?$/.test(path)
    // No `models?` folder: src/models/ almost always holds database or domain models, not AI models.
    || /(^|\/)src\/(llm|prompts?)(\/|$)/.test(path)
    || /\.(prompt|chain)\.[cm]?[jt]sx?$/.test(filename)
  );
}

/** Tests, documentation and config files are noise for feature detection. */
export function isTechnicalFeatureSource(path: string): boolean {
  const role = classifyFileRole(path);
  return role !== "test"
    && role !== "documentation"
    && role !== "config";
}

/** Roles that name an architectural layer, as opposed to test, documentation, config and the rest. */
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
