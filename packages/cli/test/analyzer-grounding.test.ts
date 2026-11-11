import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { detectFrameworks } from "../src/analyzers/detectors/frameworkDetector.js";
import { detectEntryPoints } from "../src/analyzers/graph/entryPoints.js";
import { isArchitectureSource } from "../src/analyzers/graph/sourceScope.js";
import { inferDomain, type DomainInferenceInput } from "../src/analyzers/inference/domainInference.js";
import { detectProjectMetadata, languageLabel } from "../src/analyzers/pipeline/projectMetadata.js";
import { createProjectMap } from "../src/analyzers/pipeline/projectMap.js";
import { writeAgentNavigationFiles } from "../src/cache/agentNavigation.js";

function scanned(path: string, content: string) {
  return {
    path,
    absolutePath: `/fixture/${path}`,
    extension: path.slice(path.lastIndexOf(".")),
    size: Buffer.byteLength(content),
    lines: content.split(/\r?\n/).length,
    content
  };
}

async function withProject(files: Record<string, string>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devmap-grounding-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const PACKAGE = JSON.stringify({ name: "fixture", dependencies: {} });

// ---------------------------------------------------------------------------
// Project metadata: nothing is reported that the files do not show
// ---------------------------------------------------------------------------

test("a project without TypeScript or JavaScript files reports its own language, never typescript", () => {
  const files = [
    scanned("manage.py", "import os\n"),
    scanned("app/models.py", "class Article:\n    pass\n"),
    scanned("requirements.txt", "django\n")
  ];

  assert.equal(detectProjectMetadata("/fixture", "unknown", files).language, "python");
});

test("a project with no recognised source files has an unknown language", () => {
  const files = [scanned("README.md", "# notes\n"), scanned("data/seed.csv", "a,b\n")];

  assert.equal(detectProjectMetadata("/fixture", "unknown", files).language, "unknown");
});

test("a Laravel app with a few JS files is a php project, not a javascript one", () => {
  const files = [
    scanned("app/Http/Controllers/DebtController.php", "<?php class DebtController {}\n"),
    scanned("app/Models/Debt.php", "<?php class Debt {}\n"),
    scanned("routes/web.php", "<?php\n"),
    scanned("resources/js/app.js", "import './bootstrap';\n"),
    scanned("resources/js/echo.js", "export default {};\n")
  ];

  assert.equal(detectProjectMetadata("/fixture", "unknown", files).language, "php");
});

test("a JavaScript-heavy project with a stray script in another language keeps its JS/TS language", () => {
  const files = [
    scanned("src/a.ts", "export const a = 1;\n"),
    scanned("src/b.ts", "export const b = 1;\n"),
    scanned("scripts/deploy.py", "print('x')\n")
  ];

  assert.equal(detectProjectMetadata("/fixture", "unknown", files).language, "typescript");
});

test("languageLabel gives display names", () => {
  assert.equal(languageLabel("typescript"), "TypeScript");
  assert.equal(languageLabel("php"), "PHP");
  assert.equal(languageLabel("csharp"), "C#");
  assert.equal(languageLabel("python"), "Python");
});

test("a TypeScript project is still reported as typescript", () => {
  const files = [scanned("package.json", PACKAGE), scanned("src/index.ts", "export const a = 1;\n")];

  assert.equal(detectProjectMetadata("/fixture", "unknown", files).language, "typescript");
});

test("a server framework that is only a devDependency is not the project's framework", () => {
  const manifest = JSON.stringify({
    name: "http-client",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    devDependencies: { express: "^4.0.0" }
  });
  const testServer = scanned("test/helpers/server.ts", 'import express from "express";\nexport const app = express();\n');
  const files = [scanned("package.json", manifest), scanned("src/index.ts", "export const get = () => 1;\n"), testServer];

  const frameworks = detectFrameworks(files);
  const project = detectProjectMetadata("/fixture", "unknown", files, frameworks);

  assert.deepEqual(frameworks, []);
  assert.equal(project.framework, "unknown");
  assert.deepEqual(project.projectTypes, ["library"]);
});

test("a devDependency server framework counts once production code imports it", () => {
  const manifest = JSON.stringify({ name: "bundled-api", devDependencies: { express: "^4.0.0" } });
  const files = [
    scanned("package.json", manifest),
    scanned("src/server.ts", 'import express from "express";\nexport const app = express();\n')
  ];

  assert.deepEqual(detectFrameworks(files), ["express"]);
});

test("a runtime dependency on a server framework is enough", () => {
  const manifest = JSON.stringify({ name: "api", dependencies: { fastify: "^5.0.0" } });

  assert.deepEqual(detectFrameworks([scanned("package.json", manifest)]), ["fastify"]);
});

// The settings-only pnpm-workspace.yaml (onlyBuiltDependencies, overrides) is what pnpm 10
// projects commonly have; only a `packages` list declares workspace members.
async function metadataOf(files: Record<string, string>, frameworks: Parameters<typeof detectProjectMetadata>[3]) {
  let project: ReturnType<typeof detectProjectMetadata> | undefined;
  await withProject(files, async (root) => {
    project = detectProjectMetadata(root, frameworks?.[0] ?? "unknown", Object.entries(files).map(([path, content]) => scanned(path, content)), frameworks);
  });
  return project as ReturnType<typeof detectProjectMetadata>;
}

test("pnpm-workspace.yaml without a packages list does not make a monorepo", async () => {
  const project = await metadataOf({
    "package.json": JSON.stringify({ name: "app", dependencies: { next: "^15.0.0" } }),
    "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - esbuild\n  - sharp\n"
  }, ["nextjs"]);

  assert.equal(project.workspaceType, "single-package");
});

test("pnpm-workspace.yaml packages make a monorepo, including the inline list form", async () => {
  const members = {
    "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { next: "^15.0.0" } }),
    "packages/ui/package.json": JSON.stringify({ name: "ui" }),
    "package.json": JSON.stringify({ name: "root", private: true })
  };
  const block = await metadataOf({ ...members, "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - \"packages/*\" # shared\n" }, ["nextjs"]);
  const inline = await metadataOf({ ...members, "pnpm-workspace.yaml": "packages: [apps/*, packages/*]\n" }, ["nextjs"]);

  assert.equal(block.workspaceType, "monorepo");
  assert.equal(inline.workspaceType, "monorepo");
});

test("a workspace list that only names the root is not a monorepo", async () => {
  for (const patterns of ["packages: ['.']\n", "packages:\n  - ./\n", "packages: [., '!node_modules']\n"]) {
    const project = await metadataOf({
      "package.json": JSON.stringify({ name: "blog", dependencies: { astro: "^5.0.0" } }),
      "pnpm-workspace.yaml": patterns
    }, ["astro"]);

    assert.equal(project.workspaceType, "single-package", patterns);
  }
});

test("a one-off package.json inside an app does not make it a monorepo or a library", async () => {
  const project = await metadataOf({
    "package.json": JSON.stringify({ name: "app", dependencies: { "@remix-run/react": "^2.0.0" } }),
    "remix.init/package.json": JSON.stringify({ name: "remix.init", private: true, main: "index.js" })
  }, ["remix"]);

  assert.equal(project.workspaceType, "single-package");
  assert.equal(project.projectTypes.includes("library"), false);
});

test("declaration files are never entry points, and type-test folders are not production source", () => {
  const entries = detectEntryPoints({
    "src/app/routes/auth/user-request.d.ts": ["src/app/models/user.ts"],
    "src/app/models/user.ts": [],
    "src/index.ts": ["src/app/models/user.ts"]
  });

  assert.deepEqual(entries, ["src/index.ts"]);
  assert.equal(isArchitectureSource("test-d/search-params.ts"), false);
  assert.equal(isArchitectureSource("src/search/query.ts"), true);
});

// ---------------------------------------------------------------------------
// Features: names, ids and search terms stay tied to the project's own evidence
// ---------------------------------------------------------------------------

test("search terms list only the vocabulary the project's files contain", async () => {
  await withProject({
    "package.json": PACKAGE,
    "src/auth/login.ts": "export function login() { return 1; }\n",
    "src/auth/session.ts": "export function session() { return 2; }\n",
    "src/auth/guard.ts": "export function guard() { return 3; }\n"
  }, async (root) => {
    const authentication = (await createProjectMap(root)).features.find((feature) => feature.name === "Authentication");

    assert.ok(authentication);
    for (const vendor of ["clerk", "auth0", "kinde", "firebase/auth", "@supabase/auth", "better-auth"]) {
      assert.equal(authentication.searchTerms.includes(vendor), false, `${vendor} is not in this project`);
    }
    assert.ok(authentication.searchTerms.includes("login"));
  });
});

test("an imported vendor package does appear in the search terms", async () => {
  await withProject({
    "package.json": PACKAGE,
    "src/auth/login.ts": "export function login() { return 1; }\n",
    "src/auth/session.ts": "export function session() { return 2; }\n",
    "src/auth/config.ts": 'import NextAuth from "next-auth";\nexport const handler = NextAuth({});\n'
  }, async (root) => {
    const authentication = (await createProjectMap(root)).features.find((feature) => feature.name === "Authentication");

    assert.ok(authentication?.searchTerms.includes("next-auth"));
    assert.equal(authentication.searchTerms.includes("clerk"), false);
  });
});

test("a root page and a demo folder that both singularize to Home get distinct feature names", async () => {
  const page = "---\nconst title = 'x';\n---\n<h1>{title}</h1>\n";
  await withProject({
    "package.json": PACKAGE,
    "src/pages/index.astro": page,
    "src/pages/homes/saas.astro": page,
    "src/pages/homes/startup.astro": page
  }, async (root) => {
    const names = (await createProjectMap(root)).features.map((feature) => feature.name);

    assert.equal(new Set(names).size, names.length, `duplicate names in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Home"));
    assert.ok(names.includes("Home (homes)"));
  });
});

test("agent navigation keeps both features when two names slug to the same id", async () => {
  await withProject({
    "package.json": PACKAGE,
    "src/auth/login.ts": "export function login() { return 1; }\n",
    "src/auth/session.ts": "export function session() { return 2; }\n"
  }, async (root) => {
    const snapshot = await createProjectMap(root);
    const [first] = snapshot.features;
    assert.ok(first);
    snapshot.features = [
      { ...first, name: "Checklist Item Management" },
      { ...first, name: "checklist-item Management" }
    ];

    const result = await writeAgentNavigationFiles(root, snapshot);
    const index = JSON.parse(await readFile(result.indexPath, "utf8")) as { features: Array<{ id: string; map: string }> };

    assert.deepEqual(index.features.map((feature) => feature.id), ["checklist-item-management", "checklist-item-management-2"]);
    assert.equal(result.featurePaths.length, 2);
    for (const feature of index.features) {
      assert.equal(JSON.parse(await readFile(join(root, feature.map), "utf8")).id, feature.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Domain inference: a bad model answer or a bad cache never breaks analysis
// ---------------------------------------------------------------------------

const DOMAIN_INPUT: DomainInferenceInput = {
  entityNames: ["Order", "Customer"],
  relations: [{ from: "Order", to: "Customer", kind: "belongsTo" }],
  capabilities: ["payments"],
  technicalFeatures: ["Payments"],
  routeCount: 4,
  framework: "nextjs",
  ownershipPattern: "single_user_isolated",
  crossUserFields: [],
  absentCapabilities: []
};

function answer(payload: unknown): () => Promise<string> {
  return async () => typeof payload === "string" ? payload : JSON.stringify(payload);
}

test("domain inference accepts relatedEntities written as one string", async () => {
  const result = await inferDomain(DOMAIN_INPUT, answer({
    domain: "Order Management",
    summary: "Tracks customer orders.",
    domainFeatures: [{ name: "Order Tracking", purpose: "Follow an order.", relatedEntities: "Order" }],
    confidence: 0.8
  }));

  assert.deepEqual(result?.domainFeatures.map((feature) => feature.relatedEntities), [["Order"]]);
});

test("domain inference drops features that name entities the project does not have", async () => {
  const result = await inferDomain(DOMAIN_INPUT, answer({
    domain: "Order Management",
    summary: "Tracks customer orders.",
    domainFeatures: [
      { name: "Loyalty Points", purpose: "Rewards.", relatedEntities: ["LoyaltyAccount"] },
      { name: "Customer Orders", purpose: "Orders per customer.", relatedEntities: ["customer", "Invoice"] }
    ],
    confidence: 7
  }));

  assert.deepEqual(result?.domainFeatures, [
    { name: "Customer Orders", purpose: "Orders per customer.", relatedEntities: ["Customer"] }
  ]);
  assert.equal(result?.confidence, 1);
});

test("domain inference returns null instead of throwing on unusable answers", async () => {
  assert.equal(await inferDomain(DOMAIN_INPUT, answer("not json at all")), null);
  assert.equal(await inferDomain(DOMAIN_INPUT, answer({ summary: "no domain field" })), null);
  assert.equal(await inferDomain(DOMAIN_INPUT, async () => { throw new Error("offline"); }), null);
});

async function cachedDomainRun(poison: (cache: { result: unknown }) => void, fresh: () => Promise<string>) {
  let result: Awaited<ReturnType<typeof inferDomain>> = null;
  await withProject({ "package.json": PACKAGE }, async (root) => {
    await inferDomain(DOMAIN_INPUT, answer({
      domain: "Order Management",
      summary: "Tracks customer orders.",
      domainFeatures: [{ name: "Order Tracking", purpose: "Follow an order.", relatedEntities: ["Order"] }],
      confidence: 0.5
    }), root);

    const cachePath = join(root, ".devmap", "domain-cache.json");
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    poison(cache);
    await writeFile(cachePath, JSON.stringify(cache));

    result = await inferDomain(DOMAIN_INPUT, fresh, root);
  });
  return result as Awaited<ReturnType<typeof inferDomain>>;
}

test("a cached feature with a malformed entity list is dropped without a new model call", async () => {
  let calls = 0;
  const result = await cachedDomainRun(
    (cache) => {
      (cache.result as { domainFeatures: unknown[] }).domainFeatures = [
        { name: "Order Tracking", purpose: "Follow an order.", relatedEntities: 42 }
      ];
    },
    async () => { calls += 1; return "{}"; }
  );

  assert.equal(calls, 0);
  assert.equal(result?.domain, "Order Management");
  assert.deepEqual(result?.domainFeatures, []);
});

test("a cached result that is not an object is a miss and the model is asked again", async () => {
  let calls = 0;
  const result = await cachedDomainRun(
    (cache) => { cache.result = "garbage"; },
    async () => {
      calls += 1;
      return JSON.stringify({ domain: "Fresh", summary: "Fresh answer.", domainFeatures: [], confidence: 0.4 });
    }
  );

  assert.equal(calls, 1);
  assert.equal(result?.domain, "Fresh");
});
