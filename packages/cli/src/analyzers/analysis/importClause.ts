/**
 * What may sit between `import`/`export` and `from`: names, braces, commas, `*`,
 * `as` and comments, never a quote, `;`, `=`, `(`, `)` or `:`. Stopping there and
 * capping the length keeps a quote-free file (generated types, no-semicolon
 * style) from rescanning to the end of the text at every `export`; the unbounded
 * `[^'"]+` it replaces made a file of 12,000 exported functions cost 13 seconds.
 */
export const IMPORT_CLAUSE = String.raw`[^'";:=()]{1,4000}`;
