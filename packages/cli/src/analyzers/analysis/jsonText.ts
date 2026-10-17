/**
 * JSON.parse that tolerates a leading UTF-8 byte order mark. Windows editors
 * write BOM-prefixed package.json files that npm accepts but plain JSON.parse
 * rejects, which silently emptied every manifest-based detector.
 */
export function parseJsonText(content: string): unknown {
  return JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
}
