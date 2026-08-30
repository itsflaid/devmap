import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AliasMapping {
  prefix: string;
  target: string;
}

/**
 * Load alias mappings from tsconfig.json paths and common framework conventions.
 * Supports `@/*` -> `./src/*`, `~/` -> `./src/`, and `~` -> `./src/`.
 */
export async function loadAliasMappings(projectRoot: string): Promise<AliasMapping[]> {
  const mappings: AliasMapping[] = [];

  try {
    const tsconfigPath = join(projectRoot, "tsconfig.json");
    const raw = await readFile(tsconfigPath, "utf8");
    const config = JSON.parse(raw);
    const paths = config?.compilerOptions?.paths as Record<string, string[]> | undefined;

    if (paths) {
      for (const [alias, targets] of Object.entries(paths)) {
        if (Array.isArray(targets) && targets.length > 0) {
          const prefix = alias.endsWith("*") ? alias.slice(0, -1) : alias;
          const target = targets[0].endsWith("*")
            ? targets[0].slice(0, -1)
            : targets[0];
          mappings.push({ prefix, target });
        }
      }
    }
  } catch {
    // tsconfig.json missing or unparseable — fall through to framework defaults
  }

  // Common framework conventions if no tsconfig paths defined
  if (mappings.length === 0) {
    mappings.push({ prefix: "@/", target: "./src/" });
    mappings.push({ prefix: "~/", target: "./src/" });
    mappings.push({ prefix: "~", target: "./src/" });
  }

  return mappings;
}

/**
 * Resolve an alias import specifier to a relative path using configured mappings.
 * Returns null if no mapping matches.
 */
export function resolveAlias(specifier: string, mappings: AliasMapping[]): string | null {
  for (const mapping of mappings) {
    if (mapping.prefix && specifier.startsWith(mapping.prefix)) {
      const remainder = specifier.slice(mapping.prefix.length);
      return mapping.target + remainder;
    }
  }
  return null;
}
