import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildQuestionContext } from "../src/ai/contextBuilder.js";
import { createProjectMap } from "../src/analyzers/projectMap.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtures = {
  nextjs: join(testDirectory, "fixtures", "nextjs-project"),
  express: join(testDirectory, "fixtures", "express-project")
} as const;

type ContextEvalCase = {
  name: string;
  fixture: keyof typeof fixtures;
  question: string;
  expectedFile: string;
};

const evalCases: ContextEvalCase[] = [
  {
    name: "authentication architecture",
    fixture: "nextjs",
    question: "How does authentication work?",
    expectedFile: "lib/auth.ts"
  },
  {
    name: "Indonesian authentication",
    fixture: "nextjs",
    question: "Bagaimana autentikasi pengguna bekerja?",
    expectedFile: "lib/auth.ts"
  },
  {
    name: "session implementation",
    fixture: "nextjs",
    question: "Where is the user session implemented?",
    expectedFile: "lib/auth.ts"
  },
  {
    name: "login handling",
    fixture: "nextjs",
    question: "File mana yang menangani login?",
    expectedFile: "lib/auth.ts"
  },
  {
    name: "NextAuth configuration",
    fixture: "nextjs",
    question: "Explain the NextAuth configuration",
    expectedFile: "lib/auth.ts"
  },
  {
    name: "database client",
    fixture: "nextjs",
    question: "Where is the database client initialized?",
    expectedFile: "lib/db.ts"
  },
  {
    name: "Indonesian database connection",
    fixture: "nextjs",
    question: "Di mana koneksi database dibuat?",
    expectedFile: "lib/db.ts"
  },
  {
    name: "Prisma initialization",
    fixture: "nextjs",
    question: "Which file initializes Prisma?",
    expectedFile: "lib/db.ts"
  },
  {
    name: "database access module",
    fixture: "nextjs",
    question: "Show the main db module",
    expectedFile: "lib/db.ts"
  },
  {
    name: "session API endpoint",
    fixture: "nextjs",
    question: "Where is the session API endpoint?",
    expectedFile: "app/api/session/route.ts"
  },
  {
    name: "Indonesian session route",
    fixture: "nextjs",
    question: "Route API mana yang mengembalikan sesi?",
    expectedFile: "app/api/session/route.ts"
  },
  {
    name: "GET session handler",
    fixture: "nextjs",
    question: "Which GET endpoint handles session requests?",
    expectedFile: "app/api/session/route.ts"
  },
  {
    name: "home page",
    fixture: "nextjs",
    question: "Where is the main home page?",
    expectedFile: "app/page.tsx"
  },
  {
    name: "Indonesian main page",
    fixture: "nextjs",
    question: "File mana untuk page utama?",
    expectedFile: "app/page.tsx"
  },
  {
    name: "root layout",
    fixture: "nextjs",
    question: "Where is the root layout component?",
    expectedFile: "app/layout.tsx"
  },
  {
    name: "payment implementation",
    fixture: "express",
    question: "How are payments implemented?",
    expectedFile: "src/routes/payments.ts"
  },
  {
    name: "Indonesian payment",
    fixture: "express",
    question: "Di mana pembayaran diproses?",
    expectedFile: "src/routes/payments.ts"
  },
  {
    name: "Stripe setup",
    fixture: "express",
    question: "Which file configures Stripe?",
    expectedFile: "src/routes/payments.ts"
  },
  {
    name: "Express entry point",
    fixture: "express",
    question: "Where does the Express server start?",
    expectedFile: "src/server.ts"
  },
  {
    name: "Indonesian server entry",
    fixture: "express",
    question: "File mana yang menjalankan server utama?",
    expectedFile: "src/server.ts"
  }
];

test("context builder benchmark keeps relevant files in the top results", async (testContext) => {
  const snapshots = {
    nextjs: await createProjectMap(fixtures.nextjs),
    express: await createProjectMap(fixtures.express)
  };
  const failures: string[] = [];
  const topOneMisses: string[] = [];
  let topOneHits = 0;

  for (const evalCase of evalCases) {
    const context = await buildQuestionContext(
      fixtures[evalCase.fixture],
      snapshots[evalCase.fixture],
      evalCase.question
    );
    const rankedPaths = context.files.map((file) => file.path);
    const expectedRank = rankedPaths.indexOf(evalCase.expectedFile);

    if (expectedRank === 0) {
      topOneHits += 1;
    } else {
      topOneMisses.push(
        `${evalCase.name}: expected ${evalCase.expectedFile}, got ${rankedPaths[0] ?? "none"}`
      );
    }

    if (expectedRank < 0 || expectedRank >= 3) {
      failures.push(
        `${evalCase.name}: expected ${evalCase.expectedFile}, got ${rankedPaths.join(", ")}`
      );
    }
  }

  assert.deepEqual(failures, []);
  assert.equal(topOneHits, evalCases.length);
  testContext.diagnostic(`Context Builder top-1 accuracy: ${topOneHits}/20`);
  testContext.diagnostic("Context Builder top-3 recall: 20/20");
  for (const miss of topOneMisses) {
    testContext.diagnostic(`Top-1 miss: ${miss}`);
  }
});
