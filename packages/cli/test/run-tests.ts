import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const testFiles = (await readdir(testDirectory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort();

for (const testFile of testFiles) {
  await import(pathToFileURL(join(testDirectory, testFile)).href);
}
