# 2. Scanning & Analysis

**Source:** `packages/cli/src/analyzers/analysis/`

This is where a project on disk becomes structured data DevMap can reason
about. Two jobs happen here: deciding *which files matter* (`fileScanner.ts`
+ `filterEngine.ts`), and extracting *what each file contains*
(the `AnalyzerRegistry` cascade).

## File discovery: `scanFiles()`

`fileScanner.ts` walks the project tree recursively, using `p-limit(50)` to
cap concurrent directory reads so scanning a huge `node_modules`-adjacent
tree doesn't exhaust file descriptors. Two details worth knowing:

- **Ordering is not free.** Because directories are visited concurrently,
  the order files land in the output array depends on I/O completion timing,
  not directory structure. `scanFiles` explicitly re-sorts everything by
  path before returning:

  ```ts
  return files.sort((a, b) => a.path.localeCompare(b.path));
  ```

  This single line is why the rest of the pipeline can assume deterministic
  ordering — including `createProjectFingerprint()` (ch. 1), which would
  otherwise produce a different fingerprint on every run of an unchanged
  project.
- **Unreadable files don't crash the scan.** `readFile(...).catch(() => "")`
  means a permission-denied or binary-garbage file becomes an empty string
  rather than aborting the whole analysis.

## What gets ignored: `filterEngine.ts`

`shouldIgnorePath()` combines four independent filters, checked in this
order (cheapest/most-common first):

1. **Hardcoded directory names** — `IGNORED_DIRECTORIES`: the obvious ones
   (`node_modules`, `.git`, `dist`, `build`, `coverage`) plus framework build
   caches (`.next`, `.turbo`, `.astro`, `.svelte-kit`, `.nuxt`, `.output`)
   and Python's `venv`/`__pycache__`.
2. **Hardcoded lockfiles** — `IGNORED_FILES`: every major package manager's
   lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
   `bun.lock(b)`). These are huge and add no analysis value.
3. **Pattern rules** — `.env*` anywhere in the path, anything under
   `public/assets/`, and `*.min.js`/`*.min.ts`.
4. **The project's own `.gitignore` and `.git/info/exclude`**, loaded once
   per project root and cached in a module-level `Map` (`gitignoreCache`) so
   repeated calls during a single scan don't re-read and re-parse the file.

Extension-based filtering (`IGNORED_EXTENSIONS`) is separate and covers
binary/generated formats (images, fonts, `.wasm`, `.map`, `.log`) regardless
of directory.

If you need DevMap to skip something project-specific, the project's own
`.gitignore` is almost always the right lever — DevMap deliberately doesn't
invent a second ignore-file format.

## The analyzer cascade: `AnalyzerRegistry`

`analyzeFiles()` (in `pipeline/analyzerRegistry.ts`) runs every scanned file
through three analyzers **in priority order**, first-match-wins:

```ts
const registry = new AnalyzerRegistry([
  new TsMorphAnalyzer(),
  new HeuristicAnalyzer(),
  new FallbackAnalyzer()
]);
```

`AnalyzerRegistry.analyze()` calls `supports(file)` on each analyzer in
turn; the first one that returns `true` gets to analyze the file. If that
analyzer *throws* mid-parse (malformed source), the registry silently falls
through to the next one instead of failing the whole file:

```ts
for (const analyzer of this.analyzers) {
  if (!analyzer.supports(file)) continue;
  try {
    return await analyzer.analyze(file, context);
  } catch {
    // fall through to the next analyzer
  }
}
```

This is why a single syntactically-broken `.ts` file degrades to a
`confidence: "low"` fallback entry instead of crashing `devmap analyze`
for the entire project.

### Tier 1 — `TsMorphAnalyzer` (`confidence: "high"`)

Backed by a real TypeScript compiler API (`ts-morph`), using an
**in-memory** `Project` (`useInMemoryFileSystem: true`) so nothing touches
disk beyond the initial read. It handles `.ts/.tsx/.js/.jsx` natively, and
three more formats through a **preprocessor** step (below): `.vue`,
`.svelte`, `.astro`.

For every file it extracts:
- **Imports** — from `import` declarations, re-export `from` clauses, *and*
  `require(...)` calls (so CommonJS files aren't blind spots)
- **Exports** — via `getExportedDeclarations()`
- **Symbols** — function declarations, classes (plus their methods),
  interfaces, type aliases, enums, and `const` declarations, each with line
  number, exported flag, and async flag
- **Top functions** — the same symbol list filtered to
  function/const/class/method, sorted (exported first, then by line number),
  capped at 8

One `Project` instance is reused across the whole run (not recreated per
file) — each `analyzeSource` call adds a source file, and the source file
is explicitly removed afterward (`this.project.removeSourceFile(...)`) to
avoid memory growth across a large scan.

### The preprocessor step — how `.vue`/`.svelte`/`.astro` reach `ts-morph`

`ts-morph` only parses pure JS/TS. Vue, Svelte, and Astro all embed script
code inside a larger file format, so each gets a small extractor
(`analysis/preprocessors/`) implementing:

```ts
interface LanguagePreprocessor {
  readonly extensions: string[];
  extract(content: string, filePath: string): ExtractedScript | null;
}
```

| Preprocessor | Extracts | Notes |
|---|---|---|
| `VuePreprocessor` | first `<script>`/`<script setup>` block | Also covers Nuxt — identical SFC format. Detects `lang="ts"`; TS output is parsed as `.tsx` since Vue TS files often reference JSX-like template refs. |
| `SveltePreprocessor` | instance `<script>`, falling back to `<script context="module">` | Also covers SvelteKit. Prefers the instance script because that's where props/reactive declarations live. |
| `AstroPreprocessor` | the `---`-fenced frontmatter block | Frontmatter is always treated as TypeScript — no `lang` attribute exists in Astro's syntax. |

If `extract()` returns `null` — a template-only `.vue` with no `<script>`,
a markup-only `.astro` with no frontmatter — that's treated as a **valid,
expected** case, not an error: `TsMorphAnalyzer` returns an empty
`confidence: "medium"` result rather than falling through to
`HeuristicAnalyzer` (which doesn't even list these extensions as supported,
see below).

Each `ExtractedScript` also carries a `lineOffset`, so line numbers reported
in symbols can eventually be remapped back to the original file's
coordinates rather than the extracted-snippet's coordinates.

### Tier 2 — `HeuristicAnalyzer` (`confidence: "medium"`)

Covers languages `ts-morph` has no business touching:
`.cjs .cs .cts .go .java .mjs .mts .php .py .rb`. This is pure regex —
import specifiers via one broad pattern matching `import`/`export ... from`/
`require(`, and symbols via one regex per declaration kind (function, const,
class, interface, type, enum), each capturing name/line/exported/async.

The code comments are explicit that this is a stopgap:

```ts
// TODO: Replace regex-based analysis for non-JS languages with tree-sitter
// grammars post-MVP. Current regex approach covers import/export detection
// well enough for MVP scope, but won't handle scope-aware analysis (e.g.
// distinguishing code from comments in Python).
```

Worth knowing if you're debugging a weird symbol extraction on a `.py` or
`.go` file — a regex has no concept of "inside a comment" or "inside a
string," so false positives there are a known, accepted limitation rather
than a bug to chase.

### Tier 3 — `FallbackAnalyzer` (`confidence: "low"`)

`supports()` always returns `true` — this is the safety net every other
file (and every analyzer failure) lands on. It returns an entirely empty
`FileAnalysis`: no imports, no exports, no symbols. The file still gets
scanned, hashed, and included in the file index (ch. 1) — it just
contributes no structural signal to feature detection or the dependency
graph.

## The output shape: `FileAnalysis`

Every analyzer, regardless of tier, returns the same shape:

```ts
type FileAnalysis = {
  analyzer: string;                 // "ts-morph" | "heuristic" | "fallback"
  confidence: "high" | "medium" | "low";
  imports: string[];
  exports: string[];
  symbols: SymbolInfo[];
  topFunctions: FunctionInfo[];
  routes?: RouteInfo[];             // populated later, not by the analyzer itself
};
```

This uniform shape is what lets everything downstream — the dependency
graph (ch. 9), feature detection (ch. 6), route detection (ch. 3) — stay
agnostic to which analyzer produced a given file's data. Consumers branch on
`confidence` when it matters (e.g. preferring high-confidence evidence for a
feature match) but otherwise never need to know which tier ran.

## `FileRole` — a second, independent classification

`fileRole.ts` classifies every file into a `FileRole`
(`test | documentation | config | landing-ui | cli-command | api-handler |
service | middleware | repository | ui-component | ai-integration |
application-source`) using pure path/filename pattern matching — **no**
dependency on `FileAnalysis` at all.

This is deliberately a *different* classification from the `FileScope` you
saw in ch. 1 (`api | ui | database | ...`). `FileScope` is a coarse tag
computed once inside `projectMap.ts` for high-level filtering. `FileRole` is
a finer-grained, path-driven classifier consumed heavily by the feature
detection engine (ch. 6) to answer "is this file architecturally meaningful
evidence, or is it noise (a test, a doc, a config file)?" via
`isTechnicalFeatureSource()`. The two systems overlap in intent but aren't
the same code path — don't assume changing one changes the other.

Role priority is checked top to bottom, first match wins — the doc comment
at the top of the file states the order explicitly:

```
test → documentation → config → landing-ui → cli-command
  → api-handler → service → middleware → repository
  → ui-component → ai-integration → application-source
```

Note that `ui-component` doubles as the catch-all for any `.tsx/.jsx/.vue/
.svelte/.astro` file that didn't match an earlier, more specific role —
that's why it has to run *after* `api-handler`, `landing-ui`, and
`cli-command`, not before.

## See also

- Ch. 1 for how `scanFiles`' deterministic ordering feeds
  `createProjectFingerprint`
- Ch. 6 for how `isTechnicalFeatureSource()` (built on `FileRole`) filters
  evidence during feature detection
- Ch. 4 for how extractor `supports()`/cascade pattern (same shape as
  `AnalyzerRegistry`) is reused for entity extraction
