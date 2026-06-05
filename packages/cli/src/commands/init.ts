import { ensureDevmapIgnored } from "../utils/gitignore.js";
import { output } from "../utils/output.js";
import { writeConfig } from "../utils/config.js";

export async function initCommand(): Promise<void> {
  output.section("DevMap Init");
  await writeConfig({
    provider: "groq",
    model: "auto"
  });
  output.success("Provider set to Groq");
  output.success("Config saved without API key. Add it later in ~/.devmap/config.json");

  const changed = await ensureDevmapIgnored(process.cwd());
  output.success(changed ? "Added .devmap/ to .gitignore" : ".devmap/ already ignored");
  output.step("Next: devmap analyze");
}
