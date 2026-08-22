# 4. Entity Extraction

**Source:** `packages/cli/src/analyzers/analysis/extractors/`

Entities (`User`, `Post`, `Workspace`, ...) are the backbone that
capability detection (ch. 7), feature detection (ch. 6), and AI domain
inference (ch. 11) all build on. This module's whole job is answering "what
are this project's domain objects?" — with a graceful confidence gradient
when there's no ORM schema to read.

## The strategy pattern, same shape as the analyzer cascade

Entity extraction mirrors the `AnalyzerRegistry` pattern from ch. 2 almost
exactly, just with its own interface:

```ts
export interface IEntityExtractor {
  readonly name: string;
  canHandle(files: ScannedFile[]): boolean;
  extract(files: ScannedFile[]): EntityInfo[];
}
```

`extractEntities()` (in `extractors/index.ts`) walks an ordered list,
stopping at the **first extractor that both `canHandle()` and returns a
non-empty result**:

```ts
const EXTRACTORS: IEntityExtractor[] = [
  new PrismaExtractor(),
  // new DrizzleExtractor(),   ← reserved slot, not yet implemented
  // new TypeORMExtractor(),   ← reserved slot
  // new MongooseExtractor(),  ← reserved slot
  new SQLExtractor(),
];
```

The commented-out slots aren't dead code to clean up — they're the intended
extension point. Adding ORM support later means writing one new class and
inserting it in priority order; nothing else in the chain changes. Order
encodes confidence: Prisma (full field + relation data from a real schema
file) is checked before SQL (table names guessed from query strings, no
field data at all) specifically so that a project using both an ORM *and*
occasional raw queries doesn't get its rich Prisma data discarded in favor
of noisier SQL guesses.

If **every** schema-based extractor comes up empty, there's one more rung:
a **route-hint fallback** (`RouteFallbackExtractor`, a separate
`IRouteFallbackExtractor` interface since its input is `RouteInfo[]`, not
`ScannedFile[]`) that guesses entity names from URL segments. Only if that
also finds nothing does `extractEntities` return the empty-source case:

```
Prisma schema → SQL query strings → route URL segments → empty
   (high conf)      (medium conf)        (low conf)
```

Every `EntityInfo` carries its own `source: "prisma" | "sql" | "route-hint"`,
so downstream consumers can weight evidence by confidence instead of
treating all entities as equally reliable.

## Tier 1 — `PrismaExtractor`

Parses `.prisma` files with a **regex-based** model/field parser (not
`ts-morph` — Prisma's schema language isn't TypeScript). Two regexes do the
real work: one captures `model Name { ...body... }` blocks, the other walks
each block's lines for `fieldName FieldType[]?  @attrs`. A field counts as
a relation when its type is capitalized *and* isn't one of Prisma's known
scalar types (`String`, `Int`, `DateTime`, `Json`, etc. — see
`PRISMA_SCALAR_TYPES`).

Prisma 5+ supports multi-file schemas (a `prisma/` folder with several
`.prisma` files), so `extract()` parses every `.prisma` file found and
concatenates the results — deduplication happens later, at the orchestrator
level.

### Relation direction is inferred, not stated

Prisma schemas are bidirectional by convention (both sides of a relation
declare a field), so the extractor has to *decide* a canonical direction
rather than just reading one. The rule, implemented in `buildRelations()`:

- A list field (`rooms Room[]`) → `one-to-many`, this entity is the "one"
  side.
- A non-list field where the *other* entity has no matching list field back
  → `one-to-one`.
- A non-list field where the other side *does* have a list field back →
  that's the many-to-one FK side of a relation already captured from the
  other entity's one-to-many — **skipped** here to avoid emitting the same
  relationship twice from both directions.
- Self-referential fields (`Message.sourceMessage: Message?`) are skipped
  entirely — valid Prisma, but not a cross-entity relationship worth
  modeling.

## Tier 2 — `SQLExtractor`

For projects with a raw SQL client (`pg`, `mysql2`, `better-sqlite3`, etc.)
and no ORM. This produces **pseudo-entities**: name only, `fields: []`,
`relations: []` — there's no schema to read field types from, only table
names mentioned in query strings.

Two implementation details are worth understanding because they're the
difference between this working reliably and producing garbage:

**String boundaries come from a real AST, not regex.** Table names are
pulled from string literals found via `ts-morph`
(`getDescendantsOfKind(SyntaxKind.StringLiteral)`), not a
`/"([^"]*)"/`-style scan. The code comments explain why directly: a naive
quote-pairing regex pairs the Nth quote with the (N+1)th regardless of
which statement they belong to, so a single apostrophe in a comment or
JSDoc (`doesn't`, `it's`) throws off parity for everything after it —
silently merging prose and code into one fake "string." An AST node doesn't
have that failure mode: comments and JSX text are different node kinds
entirely, so they can never leak into a `StringLiteral`'s text.

**Filtering out things that *look* like table names but aren't.** A literal
only becomes a candidate if it first matches a SQL statement shape
(`select|insert|update|delete|with`), then a `from|into|update|join
<name>` pattern. Even then, three filters reject false positives:

- `NON_ENTITY_TABLE_NAMES` — Postgres/SQLite system catalogs and migration
  bookkeeping tables (`information_schema`, `pg_catalog`, `schema_migrations`,
  `_prisma_migrations`).
- `ENGLISH_STOPWORDS` — the comment explains this one is necessary because
  ordinary UI copy ("Update your profile," "select a file from your
  computer") sits right next to real SQL keywords; without a stopword
  filter, any project with both a raw SQL client *and* normal SaaS copy
  produces bogus entities like `"Your"`.
- `TITLE_CASE_PATTERN` — a captured word starting with a capital letter
  (`DevMap`, `Stripe`) reads as a proper noun, not a `snake_case`/lowercase
  table identifier, so it's rejected too.

## Tier 3 — `RouteFallbackExtractor`

**Source:** `fallbackExtractor.ts`

The lowest-confidence tier: guess entity names from API route URL segments.
`/api/workspaces/[id]` → `Workspace`. Dynamic segments (`[id]`, `[slug]`),
segments ≤ 2 characters, and known non-entity path segments
(`api`, `v1`, `auth`, `health`, `me`, ...) are filtered out first.

The remaining segment goes through `singularize()` — a small rule-based
English singularizer (not a library), handling the common REST-pluralization
cases in priority order: an irregular-word map first (`people` → `Person`,
`children` → `Child`), then suffix rules (`-ies` → `-y`, `-sses/-xes/-ches/
-shes` → drop `-es`, `-ses` → drop `-s`, generic trailing `-s` → drop it).
This function is exported and reused by `SQLExtractor` too (table names
need the same singularization), so if you're tuning pluralization rules,
both extractors are affected.

## The entity graph's relation list is derived twice

Worth knowing if you're modifying relation logic: **`EntityInfo.relations`**
(per-entity, populated inside `PrismaExtractor.extract()` via its own
`buildRelations()`) and **`EntityGraph.relations`** (the top-level array,
computed by a *separate* `buildRelationGraph()` in `extractors/index.ts`
from the already-extracted entities) are two independent derivations of
conceptually the same information. They use very similar logic
(`field.isRelation` + list-vs-non-list + a dedup guard) but aren't the same
function, and the dedup keys differ slightly between them. If a relation
looks right on one but wrong on the other, check which of the two you
actually edited.

`extractEntities()` also owns deduplication across the whole result —
`deduplicateEntities()`, first-seen-wins by name — which matters
specifically for Prisma's multi-file schema case, where the same model
could theoretically appear if schema files overlap.

## See also

- Ch. 2 for the `AnalyzerRegistry` cascade this module's structure mirrors
- Ch. 7 for how `EntityGraph` feeds capability detection
- Ch. 11 for how `entityGraph.entityNames` and relations feed AI domain
  inference — including a case where a naive reading of entity names alone
  produces a wrong answer
