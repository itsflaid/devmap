/**
 * Inline SVG icons for the "works with" cards. Files live in
 * `src/assets/agents` and `src/assets/frameworks`, named by the `icon` key in
 * `src/data`. They are inlined (not <img>) so they take the card's text color.
 * A missing file is fine: the card falls back to a letter mark.
 */
const agentFiles = import.meta.glob<string>("../assets/agents/*.svg", {
  query: "?raw",
  import: "default",
  eager: true
});

const frameworkFiles = import.meta.glob<string>("../assets/frameworks/*.svg", {
  query: "?raw",
  import: "default",
  eager: true
});

function find(files: Record<string, string>, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const hit = Object.entries(files).find(([path]) => path.endsWith(`/${key}.svg`));
  return hit?.[1];
}

export const agentIcon = (key?: string) => find(agentFiles, key);
export const frameworkIcon = (key?: string) => find(frameworkFiles, key);
