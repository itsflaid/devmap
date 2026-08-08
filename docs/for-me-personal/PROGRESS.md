# Progress DevMap

Terakhir diperbarui: 2026-08-08

## Update 2026-08-08

### update.md — Split FeaturesSection + Docs Framework Update (branch `main`)

Diterapkan langsung di `main` (per instruksi). update.md tidak di-commit dan
sudah dihapus.

- `styles/global.css`: tambah 4 token palette inverted (`--color-bg-invert`,
  `--color-text-invert`, `--color-text-invert-muted`,
  `--color-border-invert-strong`) di `:root` setelah `--color-aqua-soft`.
  Cyan sengaja tidak masuk palette inverted — aksen tetap dark-section-only.
- `components/landing/FeaturesSection.astro`: dirombak total dari grid
  feature-card jadi split panel "How it works" — eyebrow mono, grid 2 kolom
  (1fr 1fr aktif ≥760px, stack di mobile), kolom kiri "Static analysis 80%"
  (stat pakai `--color-aqua`), kolom kanan "AI 20%" flip ke latar terang
  (`--color-bg-invert`), divider murni transisi warna tanpa border/shadow.
  Copy disesuaikan ke source: tidak ada klaim "map/flow murni static" karena
  `flow` ternyata pakai `completeWithOptionalStreaming` dan `analyze` punya
  `enrichSnapshotWithAi` — yang akurat: kiri fokus ONE-TIME analyze pass
  (berat di static parsing), kanan "AI baca snapshot, bukan raw code".
  Reveal: eyebrow + masing-masing kolom via `revealOnScroll`.
- `content/docs/overview.md`: tier framework diupdate sebagai kondisi "jika
  detector sudah selesai diimplementasikan" (detector Fastify/Nest/Vue/Svelte
  masih di planning). Full support += Fastify, Nest. Detected no route
  mapping += Vue, Svelte. Contoh "Anything else" dihapus NestJS & Vue
  (Laravel, Django, Go). Catatan: tier ini sengaja dibuat mendahului
  implementasi detector, sesuai instruksi user.
- Verifikasi: `pnpm --filter @devmap/web build` (astro check + build) 0 error.

---

### update.md — Light Section + GSAP Fixes (branch `main`, lanjutan)

4 file kena; update.md tidak di-commit dan sudah dihapus. Satu push langsung
ke `main` (tanpa PR/issue, per instruksi user).

- `scripts/stagger-reveal.ts` baru: utility `staggerReveal(elements, options)`
  — fade-up on-scroll berbasis IntersectionObserver + inline style, TANPA
  GSAP/ScrollTrigger. Dipakai di elemen yang tidak boleh menarik GSAP (Hero
  above-the-fold, biar bundle awal ringan) dan fallback mobile yang sudah
  skip GSAP (card list CommandsSection). Guard `prefers-reduced-motion`,
  fallback kalau `IntersectionObserver` tidak ada. Diekstrak dari logika
  yang sebelumnya duplikat di Hero + Commands, dependency dipertahankan.
- `HeroSection.astro`: script block diganti jadi panggilan `staggerReveal`
  pada `.index-row` (`y: 10, staggerMs: 90`).
- `CommandsSection.astro`: (1) fix pin height — `.commands-section__track`
  `calc(70vh * 7)` → `calc(48vh * 7)` (490vh → 336vh; math scrub proporsional
  ke tinggi track, tidak ada yang lain perlu diubah). (2) block observer card
  list yang panjang diganti jadi `staggerReveal(cards, { y: 16, staggerMs: 80 })`
  + import di baris atas; `const prefersReducedMotion` dipertahankan (dipakai
  guard pin/scrub).
- `OpenSourceSection.astro`: di-flip jadi light section (rewrite total) —
  `<section>` luar full-bleed dengan bg `#f5f6f7`, `.landing-section` (width
  constraint) pindah ke div `__inner` di dalamnya. Teks `#10151b` (mirror
  dari `--color-surface`), muted `#4b5563`, `:focus-visible` outline di-override
  lokal ke `--os-text` (cyan tetap dark-section-only). Dipilih karena satu dari
  tiga section tanpa aksen cyan (Comparison, OpenSource, FooterCta), kontennya
  soal trust/keterbukaan, dan posisi kedua-dari-akhir = satu jeda terang
  sebelum balik gelap di FooterCta. Lokal `--os-*` var dipakai di
  `.open-source-section--light` (nilai mirror token invert global).
- Verifikasi: `pnpm --filter @devmap/web build` (astro check + build) 0 error.

---


## Update 2026-08-07

### update2.md — Spec 02 `devmap explain` (branch `explain-command`)

Spec 02 diimplementasikan penuh; update2.md hanya instruksi dan sudah
dihapus. Satu PR untuk seluruh work.

- `utils/targetResolver.ts` baru: `resolveFileTarget` (exact → suffix →
  ambiguity error), di-refactor dari `resolveMapTarget` di `map.ts` agar
  dipakai bersama `map` dan `explain`.
- `ai/provider.ts`: `AiTask` + `"explain"`; `ai/groq.ts`: entry `explain` di
  `DEFAULT_AI_MODELS`/`DEFAULT_AI_FALLBACKS` (sama dengan analyze);
  `ai/prompts.ts`: `buildExplainMessages(targetLabel, context)`.
- `commands/explain.ts` baru: fail-fast provider check (throw `DevmapError`,
  tanpa try/catch di sekitar AI call), resolusi target feature → file →
  function (`topFunctions`, case-insensitive, ambiguity error), context
  dibangun via `buildQuestionContext` (tidak dimodifikasi), stream jawaban
  dengan `completeWithOptionalStreaming`, print baris `Context files:`.
  `--write` menulis `.devmap/explain/<slug>.md`, `--json` mengembalikan
  `ExplainResult`. Catatan desain: untuk mode function, question yang
  dikirim ke context builder adalah `"<fn> in <file>"` agar file yang berisi
  fungsi masuk ranking (keyword murni nama fungsi tidak match path/symbol).
- `index.ts`: command `explain` (argumen `<target>` required) + `explain`
  masuk `AVAILABLE_COMMANDS` di `commands/onboarding.ts`.
- `test/explain-command.test.ts`: 10 tes (fail-fast, file, suffix, feature,
  function dari snapshot asli fixture, ambiguity 2 file, not-found, `--write`,
  tanpa `--write`, prioritas resolusi feature→file→function).
- Docs: `docs/commands.md` section `devmap explain`; `docs/roadmap.md`
  tandai explain ✅ + struktur `.devmap/explain/`.

---

## Update 2026-08-06

### update.md — Fix GSAP Commands, Reveal Animations, Docs Sidebar & Navbar (branch `fix/commands-reveal-docs-nav`)

Diterapkan dari update.md ke `apps/web`, tiap bagian di-commit terpisah
(update.md sendiri tidak di-commit dan sudah dihapus; update2.md tidak
disentuh).

- `src/scripts/scroll-reveal.ts` baru: utility `revealOnScroll(container,
  selector, options)` — gsap fade+slide, guard `prefers-reduced-motion`,
  `scrollTrigger.once`. Dipakai oleh 8 section landing.
- 8 section landing ditambah `<script>` reveal (Problem, HowItWorks,
  Features, AiAgents, Comparison, Onboarding, OpenSource, FooterCta).
- `AiAgentsSection.astro` sekaligus fix overflow mobile: flow pakai
  `box-sizing: border-box` + `max-width: 100%`, row `flex-wrap: wrap`,
  command/output `min-width: 0` + `overflow-wrap: anywhere`.
- `CommandsSection.astro` fix bug utama: header + palette dibungkus
  `.commands-section__stage` di dalam `.commands-section__track`; GSAP pin
  pindah dari `.command-palette` ke `.commands-section__stage`, start
  `"top top+=96"` — header ikut scroll menjauh, palette tetap pin.
- `SidebarList.astro` fix bug utama sidebar docs unstyled: style `ul/li/a`
  (termasuk `a.active`, nested `li li a`) dipindah ke scoped style di
  komponen ini sendiri (style di parent tidak menembus scoping Astro).
  Padding pakai custom props `--docs-link-padding` /
  `--docs-link-nested-indent` agar bisa di-override dari ancestor.
- `DocsSidebar.astro`: style link dihapus (sudah pindah ke SidebarList),
  `.docs-mobile-toc__list` menambahkan override custom props
  `--docs-link-padding: 0.625rem 1rem; --docs-link-nested-indent: 2rem`.
- `SiteHeader.astro` redesign 3 zona: grid `auto 1fr auto` (brand | links |
  actions) desktop, `.site-header__menu` `display: contents`, actions berisi
  tombol Docs (`/docs`) + GitHub. Mobile: menu jadi dropdown panel full-width.
  Href nav item tetap `/#problem` dst. (prefix `/` dipertahankan agar tetap
  berfungsi dari halaman `/docs`).
- Verifikasi: `pnpm build:web` (`astro check` + `astro build`) lulus, lihat
  TEST.md untuk detail.

---

## Update 2026-08-06

### update3.md — Docs Page `/docs` (branch `landing-page`)

**Halaman docs satu halaman** dengan sidebar kiri (sticky, active section
highlight saat scroll) dan konten di kanan, memakai token yang sama dengan
landing (tanpa warna/font baru).

- `content.config.ts` baru: content collection `docs` (Astro 5 glob loader
  di `src/content/docs`, schema `title` string). Catatan: lokasi file
  `src/content.config.ts` (bukan `src/content/config.ts`) sesuai Astro 5.
- `content/docs/overview.md`: isi `devmap-docs-content.md` verbatim (file
  sumber sudah dihapus setelah disalin, sesuai instruksi user) + frontmatter.
  Tiga penambahan spec sudah termasuk di dalam sumbernya: contoh `--write`
  pada `devmap explain`, contoh `--local` + penjelasan pada `config model`,
  dan baris `.devmap/config.local.json` di tabel Generated files.
- `pages/docs.astro`: `getEntry("docs", "overview")` + `render()` (API
  Astro 5, bukan `entry.render()`), grid desktop `240px 1fr` gap 48px,
  konten max-width 720px, padding-top menyesuaikan fixed header 4rem.
- `components/docs/DocsSidebar.astro` + `SidebarList.astro` (rekursif):
  tree depth-2/depth-3 dari `headings` yang sebenarnya (bukan array manual,
  sehingga tidak drift saat markdown diedit). Teks heading dibersihkan dari
  backtick. Href memakai slug asli dari Astro.
- IntersectionObserver (rootMargin band sepertiga atas viewport) toggle
  class `.active` di sidebar desktop + mobile. Tanpa JS default netral.
- Mobile <760px: sidebar jadi `<details class="docs-mobile-toc">` sticky di
  top 4rem, max-height 60vh list, klik link menutup panel, chevron rotate
  via CSS `details[open]`.
- `SiteHeader.astro`: nav hamburger (2 span bar → X), `.site-header__links`
  jadi dropdown panel absolute saat `.is-open`, tutup via Escape / klik link,
  transition dimatikan saat `prefers-reduced-motion: reduce`. Link "Docs"
  (href `/docs`) ditambahkan ke navigationItems.
- `styles/docs-prose.css`: prose tokens landing (text muted, mono inline
  code surface+border, fenced block bg-soft, tabel plain border, hr border).
  Shiki override via CSS: `.astro-code, .astro-code span` dipaksa
  `var(--color-text)` + transparent background, komentar italic jadi
  `--color-text-subtle` (tidak menyentuh astro.config).
- Build: `astro check` 0 error/warning/hint, 2 page (/, /docs) built.
  Serve test: `/` dan `/docs` 200. Sidebar memuat 8 top-level sections
  (Quick Start + 1-7) + 6 sub-item command di bawah "4. Command reference".
  Screenshot visual belum bisa dibuat oleh agent (tidak ada browser tool) —
  checklist visual update3 point 2-10 perlu konfirmasi manual.

---

## Update 2026-08-06

### update1.md — Ask Your Codebase + Per-Project Model Override (branch `landing-page`)

**Part A — landing page "Ask Your Codebase" section:**

- Installed `gsap ^3.15.0` dan `lenis ^1.3.26` di `apps/web`.
- `src/scripts/lenis-init.ts`: global Lenis + GSAP ScrollTrigger wiring,
  dengan guard `prefers-reduced-motion` (skip Lenis animasi scroll,
  ScrollTrigger tidak dibuat).
- `BaseLayout.astro`: import script lenis-init sebelum `</body>`.
- `CommandsSection.astro` baru: section scroll-driven desktop palette
  (GSAP pin/scrub), 7 baris command (init, analyze, onboarding, map, flow,
  explain, doctor) dengan fase typing/select/preview, static cards untuk
  mobile/reduced-motion. Data command via `#commands-data` JSON
  (`is:inline`), provenance REAL/MOCK/CONSTRUCTED via frontmatter comments.
- `index.astro`: `<CommandsSection />` disisipkan antara AiAgents dan
  Onboarding, komentar PAGE STRUCTURE dinomori ulang.
- `ComparisonSection.astro`: tabel metrics diganti 5 baris persis update1
  (structure found / what gets sent to AI / context per session / starting
  new session / works across AI tools).
- `pnpm --filter @devmap/web build` lulus 0 error; chunk ScrollTrigger +
  lenis terkonfirmasi di dist.

**Part B — per-project model override (`.devmap/config.local.json`):**

- `utils/config.ts`: `LocalDevmapConfig`, `getLocalConfigPath`,
  `readLocalConfig` (abaikan `apiKey`/`provider` + warning sekali),
  `writeLocalConfig`, `resolveEffectiveConfig(projectRoot)` dengan
  `ConfigReaders` injection untuk test. `DevmapConfig`/`readConfig`/
  `writeConfig`/`getConfigPath` tidak diubah.
- `commands/analyze.ts` + `commands/flow.ts`: call site penentu model AI
  pindah dari `readConfig()` ke `resolveEffectiveConfig(projectRoot)`.
- `commands/config.ts` + `index.ts`: flag `--local` di `config model`.
  `provider`/`apiKey` tetap global-only, tidak ada `--local` di tempat lain.
- `commands/doctor.ts`: output model aktif kini berlabel sumbernya:
  `model: qwen/qwen3.6-27b (project override)` vs `model: auto (global)`.
- Test baru `config-local.test.ts` (6 kasus) + tambahan di
  `doctor.test.ts`, `analyze-ai.test.ts`, `flow-command.test.ts`.
- Verification: `pnpm --filter devmap test:unit` → 199 pass / 0 fail;
  `pnpm --filter devmap test:types` → 0 error.
- docs/commands.md diperbarui (config model --local, doctor model source).

---

## Update 2026-08-05

### Landing Page Redesign — Spec 03 (branch `landing-page`)

Mengarahkan ulang landing page dari dark-navy + neon + terminal-chrome ke
arah editorial calm (Linear/Resend/Vercel): satu warna accent (aqua `#2ee6d6`)
dipakai sangat hemat, satu motion moment per section, dan konten produk nyata
sebagai material visual.

**Token & sistem desain:**

- `global.css`: `:root` diganti total (bg `#0a0d11`, surface `#10151b`,
  border white 0.08/0.16, text `#eef1f4`, aqua `#2ee6d6` + `--color-aqua-soft`,
  font Inter + JetBrains Mono). `::selection` memakai aqua. Ditambahkan rule
  `:focus-visible` global.
- Class CTA bersama ditambahkan di `global.css` (`.cta-primary`, `.cta-secondary`)
  agar tombol install di Hero dan FooterCta selalu identik.
- `BaseLayout.astro`: font Google dari Geist diganti ke Inter + JetBrains Mono.

**Section yang diimplementasikan:**

- `SiteHeader`: hapus meta "CLI Context Layer", layout brand-kiri/nav-kanan,
  token baru, wordmark `dev` + `map` (map aqua).
- `HeroSection`: hapus typing effect, tab snapshot, cursor glow, dan grid.
  Copy final dari preview editorial (eyebrow, H1 "Analyze once. Reuse context
  everywhere.", CTA install, meta line MIT). Diagram SVG rusak diganti
  **vertical structural index list** (flex timeline, dot critical aqua, garis
  `--color-border-strong`), header `devmap analyze`, caption "One snapshot.
  Reused by every question after this." Animasi reveal stagger via
  IntersectionObserver, default state fully visible, skip penuh saat
  `prefers-reduced-motion`.
- `Problem`: sequence agent-focused (01/02/03), bridge baru, tanpa aqua.
- `HowItWorks`: step 03 `devmap explain` (bukan `devmap ask` yang sudah dihapus).
- `Features`: 6 kartu baru (Language Aware di-drop), kartu 4 = DEVMAP.md.
- `AiAgents`: flow dipecah jadi dua baris (init → DEVMAP.md, analyze →
  .devmap/snapshot.json), list compatible plain text.
- `Comparison`: tabel tanpa styling "winner".
- `Onboarding`: status "Phase 2" dihapus, tampil sebagai live feature.
- `OpenSource` / `FooterCta` / `SiteFooter`: treatment tenang, CTA install
  identik dengan Hero.

**Keputusan penting:**

- `devmap explain` diperlakukan sebagai sudah rilis di seluruh copy landing
  (sedang dibangun di Spec 02).
- `devmap ask` tidak muncul di mana pun.
- Logo di-reserve sebagai `apps/web/public/logo-devmap.png` (PNG, bukan SVG),
  direferensi via `<img src="/logo-devmap.png">` di header dan footer. Slot
  kosong sampai Fadil drop file aslinya.
- Hard rule: tanpa em dash (`—`) di seluruh `apps/web/src`, satu headline per
  section, numbering 01/02/03 hanya di Problem & How It Works, accent budget
  satu per section.

---

### `devmap flow` Command — Spec 01 (branch `command-flow`)

Menambahkan `devmap flow [target] [--all] [--json]` — view temporal
"how does this feature work end-to-end" yang melengkapi view spatial
`devmap map`.

**Fitur:**

- Default: render `snapshot.flows` apa adanya — set tersebut sudah di-curate
  pada saat `analyze` (feature flows high-confidence cap 3 + request flows API
  cap 5). Tidak ada re-ranking.
- `--all`: rebuild flow set lebih besar dari snapshot (features/routes/
  fileIndex/fileGraph) tanpa scan ulang disk dan tanpa re-run analyze.
  `generateFeatureFlows`/`generateRequestFlows` di-export dengan opsi
  backward compatible (`limit`, `minConfidence`, `includeAllRouteKinds`).
  `renderMermaidFlow` juga di-export agar flow.ts reuse langsung.
- Narration AI opsional (`AiTask = "flowNarration"`): satu paragraf pendek
  per flow dari structured step list (bukan re-read source file). Fallback
  ke plain step list per-flow kalau satu call gagal, tidak menghentikan
  command. Tanpa API key → satu note "not configured" sekali per invocation.
- Output: `.devmap/flows/<slug>.md` + `.devmap/flows/<slug>.mermaid`,
  index terminal (name + purpose) ketika multi-flow tanpa target,
  JSON `FlowResult` saat `--json`.
- Target resolution mirip `resolveMapTarget`: exact → partial unik →
  DevmapError dengan daftar known flows / hint "matches multiple flows".
- `slugifyMapName` dipindah dari `map.ts` ke shared `utils/slug.ts`.

**File:**

- New: `packages/cli/src/commands/flow.ts`, `packages/cli/src/utils/slug.ts`,
  `packages/cli/test/flow-command.test.ts`.
- Modified: `analyzers/pipeline/projectMap.ts`, `analyzers/pipeline/index.ts`,
  `commands/map.ts`, `ai/provider.ts`, `ai/groq.ts`, `ai/prompts.ts`,
  `src/index.ts`, `docs/commands.md`, `docs/roadmap.md`,
  `docs/generated-files.md`.

**Verification:**

- `pnpm test:unit` dan `pnpm test:types` — lihat TEST.md untuk angka terkini.
- Runtime verification di fixture nextjs/express/react dengan `dist` build —
  langkah dan hasil aktual ada di TEST.md.

---

## Update 2026-06-30

### Feature Detection Quality Fixes — Complete

Semua 5 bug dari `fixbug.md` telah diimplementasikan di branch `fix-feature-quality`.

**Bug #1 — `findEntityFiles()` filter:**
- Ditambahkan `.filter(f => isFeatureEvidenceFile(f.path))` sebagai first filter
- Ditambahkan filter exclude non-source extension (`.sql`, `.lock`, `.log`, `.md` di luar `docs/`)
- Ditambahkan `entityFileTierScore()` untuk sorting prioritas (source > prisma > excluded)

**Bug #2 — `classifyFileTier()` invariant:**
- Type `FileTier` dan function `classifyFileTier()` dibuat di `featureDetector.ts`
- Filter `entryPoints` diterapkan di `createFeatureInfo()`, `capabilitiesToFeatures()`
- Filter `criticalFiles` diterapkan di `rankCriticalFiles()` (projectMap.ts)

**Bug #3 — `minimumDistinctFiles` guard:**
- Field `minimumDistinctFiles` ditambahkan ke type `FEATURE_SIGNALS`
- Set `minimumDistinctFiles: 2` untuk Search, Analytics, CMS & Content, Notifications
- Evidence difilter by tier sebelum `minimumDistinctFiles` check

**Bug #4 — Empty guard di `entityGraphToFeatures()`:**
- Guard `if (entityFiles.length === 0) continue;` ditambahkan
- `entryPoints` sekarang diisi menggunakan `scoreEntryPointRelevance()`
- Confidence downgrade rule: 1 file + tier reference → `"low"`

**Bug #5 — Domain inference fixes:**
- File baru: `ownershipTopology.ts` dengan `classifyOwnershipTopology()`
- `DomainInferenceInput` tipe diperluas: `ownershipPattern`, `crossUserFields`, `absentCapabilities`
- Cache hash di-bump ke `v: 2` untuk mencegah stale cache collision
- Prompt instruction diperbarui dengan aturan ownership-based domain inference

**Verification:**
```bash
pnpm test:types        # typecheck — 0 errors
pnpm test:unit         # 121 pass, 16 fail (pre-existing, unchanged)
pnpm build             # tsc compile — 0 errors
```

---

## Update 2026-06-29

### Hardening Merge — Complete

All 9 steps of `hardening-merge-plan.md` completed in Session 2.

**Step 4 — `projectMap.ts` Confidence boost quality gate:**
- `attachFeatureEntryPoints` now accepts 5th parameter `analyses?: Record<string, FileAnalysis>`
- Confidence only boosted to "high" when at least 1 evidence file has `analysisConfidence: "high"`
- Prevents 2 low-quality fallback files from falsely boosting confidence

**Step 5 — `featureDetector.ts` Signal fixes:**
- Removed `"posthog"`, `"@posthog"` from Logging & Monitoring signal (they remain in Analytics)
- Replaced hardcoded `featureName === "AI Integration"` with `importOnly?: true` flag on FEATURE_SIGNALS type
- `matchesSignal` now checks `signal.importOnly` instead of feature name string

**Step 6 — `domainInference.ts` Medium confidence inclusion:**
- `buildDomainInferenceInput` filter changed from `f.confidence === "high"` to `f.confidence === "high" || f.confidence === "medium"`
- Capability features with medium confidence now contribute to domain inference input

**Step 7 — `featureDetector.ts` Regex pre-compile:**
- Added `regexCache` Map at module scope to cache compiled RegExp patterns per term
- Prevents repeated `new RegExp()` calls for static terms ≤7 chars in `matchesPathTerm`

**Step 8 — Unit tests (22 scenarios):**
- New file: `test/feature-similarity-merge.test.ts`
- Covers: `computeSimilarity`, `findSimilarFeature`, `mergeIntoFeatureList`, `mergeFeatureData`, `mergeDomainFeatures`, `jaccardSimilarity`, `trigramSimilarity`, `buildFeatureFingerprint`, `fingerprintSimilarity`, `attachFeatureEntryPoints`
- All 22 tests pass

**Step 9 — Regression + typecheck:**
- Typecheck passes
- 120/137 tests pass (17 pre-existing failures unchanged)

**Verification:**
```bash
pnpm test:types        # typecheck
pnpm test:unit         # unit tests (120 pass, 17 pre-existing fail)
```

---

## Update 2026-06-28

### Analyzer Structural Refactor — Flat to Subdirectory Layout

Memindahkan 30+ file dari `src/analyzers/` flat menjadi subdirektori berdasarkan
tanggung jawab, tanpa mengubah satu baris logika analyzer.

**Subdirektori baru:**

- `pipeline/` — `projectMap.ts`, `analyzerRegistry.ts`, `filterEngine.ts`,
  `featureMerge.ts`, `featureSimilarity.ts`, `entryPoints.ts`
- `features/` — `featureDetector.ts`, `fileRole.ts`
- `detectors/` — `frameworkDetector.ts`, `routeDetector.ts`,
  `serviceDetector.ts`, `databaseDetector.ts`, `capabilityDetector.ts`
- `analysis/` — `fileScanner.ts`, `fileAnalysis.ts`, `tsMorphAnalyzer.ts`,
  `heuristicAnalyzer.ts`, `sourceScope.ts`
- `graph/` — `dependencyGraph.ts`
- `inference/` — `domainInference.ts`, `projectMetadata.ts`
- `extractors/` — tetap (sudah ada)
- `preprocessors/` — tetap (sudah ada)

**Import path updates:**

- `src/commands/analyze.ts` — `projectMap.ts` → `pipeline/projectMap.js`
- `src/commands/doctor.ts` — 3 imports pointing to analyzers/* → new paths
- `src/commands/onboarding.ts` — `projectMap.ts` → `pipeline/projectMap.js`
- `src/cache/snapshot.ts` — `projectMap.ts` → `pipeline/projectMap.js`
- `src/cache/agentNavigation.ts` — `projectMap.ts` → `pipeline/projectMap.js`
- `src/onboarding/modelBuilder.ts` — `projectMap.ts` → `pipeline/projectMap.js`
- `src/ai/contextBuilder.ts` — `analyzerRegistry.ts` → `pipeline/analyzerRegistry.js`
- `src/ai/prompts.ts` — `analyzerRegistry.ts` → `pipeline/analyzerRegistry.js`
- `src/ai/snapshotEnrichment.ts` — `projectMap.ts` → `pipeline/projectMap.js`
- 13 test files — fixture imports and inline source paths updated

**Verifikasi:**

- `pnpm test:unit` — 98 pass, 17 fail (identik dengan pre-refactor)
- `pnpm test:types` — lulus
- Tidak ada test baru yang gagal akibat refactor

---

## Update 2026-06-26

### Preprocessor Layer — Vue, Svelte, Astro Support

Ditambahkan layer preprocessor baru sebelum ts-morph untuk menangani file
yang mengandung embedded JS/TS di dalam format non-native.

**File baru:**

- `src/analyzers/preprocessors/types.ts` — interface `LanguagePreprocessor`
  dan type `ExtractedScript`. Interface ini adalah kontrak yang harus
  diimplementasikan oleh setiap preprocessor baru.
- `src/analyzers/preprocessors/vuePreprocessor.ts` — ekstrak `<script>` dan
  `<script setup>` dari Vue SFC, support `lang="ts"`. Satu preprocessor
  mencakup Vue dan Nuxt karena format file identik.
- `src/analyzers/preprocessors/sveltePreprocessor.ts` — ekstrak `<script>`
  dari Svelte component, prefer instance script dibanding module script.
  Mencakup Svelte dan SvelteKit.
- `src/analyzers/preprocessors/astroPreprocessor.ts` — ekstrak frontmatter
  `---` dari Astro component. Frontmatter selalu TypeScript by default.

**File diubah:**

- `src/analyzers/tsMorphAnalyzer.ts` — `supports()` sekarang menerima
  `.vue`, `.svelte`, `.astro` selain native `.ts/.tsx/.js/.jsx`. `analyze()`
  menjalankan preprocessor sebelum ts-morph untuk file non-native. File
  tanpa script block (template-only) menghasilkan empty analysis dengan
  confidence `"medium"` daripada crash.
- `src/analyzers/heuristicAnalyzer.ts` — hapus `.vue`, `.svelte`, `.astro`
  dari `HEURISTIC_EXTENSIONS`. Boundary antar analyzer sekarang eksplisit:
  ts-morph handle semua JS/TS termasuk yang embedded, heuristic handle
  non-JS murni seperti Python/PHP/Go.

---

### Domain Feature Detection Pipeline

Ditambahkan pipeline baru untuk mendeteksi fitur domain spesifik project
(Snippet Management, Workspace, Order Management, dll) tanpa hardcode nama
domain. Pipeline terdiri dari tiga layer yang bekerja secara berurutan.

**File baru:**

- `src/analyzers/extractors/types.ts` — type `EntityInfo`, `EntityGraph`,
  `RelationInfo`, interface `IEntityExtractor`. Siap multi-source: tambah
  extractor baru = tambah satu file + satu if block di index.ts.
- `src/analyzers/extractors/index.ts` — orchestrator fallback chain.
  Coba tiap extractor berurutan, fallback ke route hints kalau semua gagal.
- `src/analyzers/extractors/prismaExtractor.ts` — parse `schema.prisma`
  untuk ekstrak model names, field types, dan relasi antar model. Deteksi
  relasi: one-to-one, one-to-many, many-to-many dari field list dan
  back-reference.
- `src/analyzers/extractors/routeFallbackExtractor.ts` — derive entity names
  dari URL segments sebagai fallback kalau tidak ada schema. `/api/snippets`
  → `Snippet`. Singularize: `categories` → `Category`, `replies` → `Reply`.
- `src/analyzers/capabilityDetector.ts` — detect capabilities dari route
  HTTP methods dan path patterns. CRUD: group routes by resource, cek
  GET+POST+PUT+DELETE coverage. Behavioral: sharing, collaboration,
  discovery, social, file-management, real-time, search, reporting.
- `src/analyzers/domainInference.ts` — Step 5, AI domain inference. Kirim
  structured metadata (bukan raw code) ke AI, dapat domain summary dan
  domain-specific features. Token usage ~300-500 per call. Return null
  kalau AI tidak tersedia — static features tetap ada.

**File diubah:**

- `src/analyzers/featureDetector.ts` — tambah import `EntityGraph` dan
  `CapabilityInfo`. `detectFeatures()` terima dua parameter opsional baru:
  `entityGraph` dan `capabilities`. Tambah `capabilitiesToFeatures()` dan
  `entityGraphToFeatures()` untuk convert hasil pipeline ke `FeatureInfo[]`.
  Hapus `DOMAIN_ROUTE_SIGNALS` dan `inferDomainFeatures()` yang sebelumnya
  ada — approach route-segment-to-feature-name dianggap tidak scalable.
  `FEATURE_SIGNALS` diperluas dari 6 ke 15 signal dengan library terms
  lebih lengkap. `matchesSignal()` diperbaiki: term pendek ≤3 karakter
  (`"ai"`, `"cms"`, `"db"`) pakai whole-word matching dengan regex
  `(?:^|[/._-])term(?:[/._-]|$)` — mencegah `"ai"` false positive pada
  path `tailwind.config.ts` atau `SnippetDetail.tsx`.
- `src/analyzers/fileRole.ts` — hapus role `"snapshot-engine"` dan
  `"analysis-engine"` yang spesifik DevMap. Tambah enam generic roles:
  `"config"`, `"api-handler"`, `"service"`, `"middleware"`, `"repository"`,
  `"ui-component"`. Export baru: `isArchitecturalRole()`.
- `src/analyzers/routeDetector.ts` — fix monorepo prefix: ganti
  `^(?:src\/)?app\/` ke `(?:^|\/)(?:src\/)?app\/` agar path
  `apps/web/src/app/api/...` ke-detect dengan benar. Fix yang sama
  diterapkan ke Pages Router pattern.
- `src/analyzers/frameworkDetector.ts` — gate Express file-pattern
  detection di balik dep check. `server.ts` dan `app.ts` adalah filename
  umum di Next.js — tanpa gate ini bisa false positive.
- `src/analyzers/projectMap.ts` — tambah import `extractEntities`,
  `detectCapabilities`, `inferDomain`. Tambah `entityGraph`, `capabilities`,
  dan `domain` ke `ProjectMap` type (semua opsional). `createProjectMap()`
  terima `callAI` opsional — kalau tidak ada, static analysis tetap jalan
  normal. Pipeline sekarang punya Step 1-4 eksplisit sebelum `rankCriticalFiles`.
  `buildStructuralFeatureFlow()` di-generalize: hapus hardcode DevMap paths,
  ganti dengan role-based dan naming-convention detection yang berlaku
  untuk project apapun.
- `src/commands/analyze.ts` — tambah `buildCallAI()` helper yang wrap
  `AiClient` menjadi `(prompt: string) => Promise<string>`. Pass ke
  `createProjectMap()`. Tambah domain section di `printSnapshot()`.

---

### False Positive Fix: AI Integration di DevNote

DevNote ke-detect punya "AI Integration" padahal tidak memakai AI library.
Root cause: `matchesSignal()` pakai `path.includes("ai")` yang match
substring di `tailwind.config.ts` ("tai**l**w**i**nd") dan
`SnippetDetail.tsx` ("det**ai**l").

Fix: term ≤3 karakter harus match sebagai whole word/segment, bukan
substring. `"ai"` sekarang hanya match kalau dikelilingi separator path
(`/`, `.`, `_`, `-`).

---

### ROLE_FEATURES Generalized

`ROLE_FEATURES` sebelumnya mengandung `"snapshot-engine"` dan
`"analysis-engine"` yang hanya match di project DevMap sendiri. Di project
Express/Next.js biasa, kedua role itu menghasilkan evidence kosong — wasted
computation tanpa output.

Sekarang ROLE_FEATURES berisi 9 entries yang semua generic: Documentation,
Web Landing, CLI Commands, API Layer, Service Layer, Middleware, Data Access
Layer, UI Components, AI Integration.

---

## Update 2026-06-23

### Groq Model Picker And Analyze Deep Removal

- `~/.devmap/config.json` tetap menyimpan `provider`, `apiKey`, dan `model`.
  Config lama tanpa `provider` atau `model` dibaca sebagai `provider: "groq"`
  dan `model: "auto"` agar tetap backward compatible.
- `devmap init` untuk Groq sekarang mengambil daftar model dari endpoint model
  Groq setelah API key valid, lalu menampilkan picker arrow-key/Enter.
- Model Groq yang dipilih disimpan ke global config dan dapat diganti dengan
  `devmap config model <model-id>`.
- OpenRouter setup tidak diubah: tetap memakai prompt model text dengan default
  `openrouter/free`.
- Flag `devmap analyze --deep` dihapus dari CLI dan dokumentasi aktif. Hasil
  investigasi: analyzer static, snapshot, dan cache path-nya sama; perbedaan
  sebelumnya hanya routing model/fallback, prompt/token limit, dan output
  `Module Breakdown` kecil.

---

### Ask Command — Complete Removal

- **Seluruh fitur `devmap ask` dihapus permanen.**
- File dihapus: `src/commands/ask.ts`, `test/ask-command.test.ts`.
- **Source code clean-up:**
  - `index.ts` — hapus import dan registrasi command `ask`.
  - `provider.ts` — hapus `"ask"` dari `AiTask` union type.
  - `groq.ts` — hapus `DEFAULT_AI_MODELS.ask` dan `DEFAULT_AI_FALLBACKS.ask`.
  - `prompts.ts` — hapus `buildAskMessages`, `buildQueryExpansionMessages`, type `AskProjectSummary`.
  - `doctor.ts` — ganti `resolveAiRouting(config, "ask")` → `"analyze"`.
  - `featureDetector.ts` — hapus `"ask"` dari terms CLI Commands.
- **Test files clean-up:**
  - Hapus `test/ask-command.test.ts`.
  - `json-output.test.ts` — hapus test `ask --json`.
  - `ai-client.test.ts` — hapus test `ask prompt`, ganti model constants jadi `deepAnalyze`.
  - `openrouter-client.test.ts` — ganti `"ask"` jadi `"analyze"`.
  - `doctor.test.ts` — update expected model regex.
- **Dokumentasi:** hapus semua referensi `devmap ask` dari `PRD.md`, `docs/commands.md`, `docs/architecture.md`, `README.md`, `CONTRIBUTING.md`, `packages/cli/README.md`, `docs/design.md`, `docs/roadmap.md`, `docs/releasing.md`, `docs/generated-files.md`.
- **Personal notes:** update `TEST.md`, `PROGRESS.md`, `DEBUG.md` (tandai entri ask sebagai removed).
- **Test suite:** 112 pass, 2 fail (keduanya pre-existing — `analyzers.test.ts` routes params bug dan `context-builder.test.ts` confidence threshold).
- **Type check:** lulus tanpa error.

---

## Update 2026-06-22

### Onboarding Generator Refactor — Model Layer Separation

- Memisahkan business logic dari renderer dengan arsitektur baru:
  `Snapshot → buildOnboardingModel() → OnboardingModel → buildOnboardingMarkdown() → Markdown`.
- **`src/onboarding/model.ts`** — tipe `OnboardingModel` yang hanya berisi data
  siap-render (minimal, tanpa properti snapshot mentah).
- **`src/onboarding/modelBuilder.ts`** — `buildOnboardingModel()` pure function
  yang menerima `ProjectMap` dan `OnboardingLanguage`, lalu mengembalikan
  `OnboardingModel`. Semua heuristik (priority ranking, grouping, konsep, flow)
  dipindahkan ke sini.
- **`src/commands/onboarding.ts`** — renderer kini hanya thin adapter yang
  menerima `OnboardingModel` dan menghasilkan markdown via string builder.
  Adapter minimal (`renderReadingAreasFromModel`, `renderKeyFlowsFromModel`)
  tanpa business logic.
- **`isStale`** dipindahkan ke options renderer, bukan bagian dari model.
- **Helper existing tetap di shared utils** — tidak dipindahkan ke builder.
- **Dead code removal** — ~700 line helper functions yang tidak lagi dipanggil
  (lama `renderProjectIntroduction`, `renderMentalModel`, `groupReadingItems`,
  dll.) dihapus dari `onboarding.ts`. Logikanya sudah ada di `modelBuilder.ts`.
- **Format output tidak berubah** — seluruh 118 test lama tetap lulus.
- **Unit test baru** — `test/onboarding-model.test.ts` mencakup: snapshot full,
  bahasa Indonesia, validasi priority range, dan empty snapshot edge case.
- **TypeScript** — strict type check lulus tanpa error.
- **Total test suite**: 122 test, 0 fail.

## Update 2026-06-21

### Snapshot Accuracy For Mixed Workspaces

- Project metadata sekarang memisahkan primary `framework` dari daftar
  `frameworks` yang ditemukan pada package workspace.
- DevMap sendiri diklasifikasikan sebagai `node-cli` monorepo dengan primary
  framework `unknown` dan workspace framework `astro`, bukan Next.js.
- Astro detection saat ini hanya memakai dependency dan pola page `.astro`;
  belum ada deep Astro analyzer.
- Documentation feature map memprioritaskan root README, AGENTS, CONTRIBUTING,
  dan PRD sebelum README internal di assets/package.
- Static file purpose menjelaskan tanggung jawab file dan tidak lagi memakai
  template daftar export yang diawali `exposes`.
- AI flow menyebut Groq dan OpenRouter sebagai adapter provider alternatif.
- Critical scoring memberi bobot lebih besar pada execution owners seperti
  project map dan file scanner, serta menurunkan shared types/constants.
- Regression fixture mixed CLI/Astro dan full suite lulus dengan 118 test.

## Update 2026-06-20

### OpenRouter MVP Provider

- `devmap init` sekarang menampilkan selector panah untuk Groq dan OpenRouter.
- Setup OpenRouter memvalidasi API key lalu meminta model dengan default
  `openrouter/free` ketika user langsung menekan Enter.
- Model OpenRouter yang diketik user, baik gratis maupun berbayar, disimpan dan
  selalu diprioritaskan tanpa hidden fallback dari DevMap.
- `devmap config model <model-id>` dapat mengganti pilihan; `auto` pada
  OpenRouter kembali ke `openrouter/free`.
- `ask`, `analyze`, dan `doctor` sekarang memakai provider factory berdasarkan
  config, bukan membuat Groq client secara langsung.
- OpenRouter completion, streaming SSE, usage normalization, validasi key, dan
  native ordered `models` request sudah memiliki regression tests.
- Focused tests dan full CLI unit suite lulus dengan 116 test.

### Standalone React Detection

- Framework detector sekarang mengenali standalone React dari dependency
  `react`, browser runtime/tooling, dan bukti JSX/TSX source.
- Next.js tetap memiliki precedence karena Next juga memakai React.
- Folder generik `src/app/` tidak lagi otomatis dianggap Next.js; fallback
  source membutuhkan `app/page`, `app/layout`, `app/route`, atau Next config.
- React peer dependency tanpa runtime app tidak diklasifikasikan sebagai
  framework React, sehingga component library tidak menjadi false positive.
- Entry detector sekarang mengenali `main.tsx` sebagai browser entry point.
- Packed-package E2E mencakup fixture React selain Next.js dan Express.

### Project Classification Dan Start-Here Ranking

- Agent index sekarang memisahkan `framework`, `projectType`, dan
  `workspaceType`; DevMap terdeteksi sebagai TypeScript `node-cli` monorepo
  tanpa memalsukan framework baru.
- Package manifest utama dipilih berdasarkan bentuk project, sehingga summary
  CLI memakai description package CLI dan bukan statistik jumlah file.
- Deteksi language memakai dominasi source agar sedikit file config JS tidak
  mengubah TypeScript codebase menjadi `mixed`.
- `criticalFiles` index memprioritaskan executable entry point, CLI
  orchestrator, flow owner, dan feature owner sebelum importance/import count.
- Fresh static validation menghasilkan urutan `index.ts`, `analyze.ts`, lalu
  `projectMap.ts`; `groq.ts` tidak lagi mendahului analysis flow utama.
- `sourcePriority` dan behavioral flow dipertahankan; keduanya sudah tersedia
  sebelum perubahan ini dan kini memiliki regression coverage bersama.

### Ordered Groq Model Fallback

- Mengganti single fallback dengan chain berbeda untuk `ask`, `analyze`, dan
  `analyze --deep`.
- Chain memakai model Groq aktif dari Qwen, Llama Versatile, GPT-OSS, dan
  Llama Instant sesuai kebutuhan command.
- HTTP 429 tetap mendapat tiga exponential-backoff retry pada model aktif,
  lalu berpindah ke model berikutnya jika limit belum pulih.
- Model unavailable dan HTTP 5xx dapat berpindah model; error API key atau
  request invalid berhenti langsung.
- Resolver menghapus model duplikat dan tetap mendukung field legacy
  `fallbackModel` untuk kompatibilitas client.
- Model list diverifikasi melalui endpoint Groq akun development pada
  2026-06-20 tanpa mencetak atau menyimpan API key.

### AST Analyzer Dan Agent Navigation

- Menambahkan analyzer registry dengan output `FileAnalysis` yang konsisten.
- `.ts`, `.tsx`, `.js`, dan `.jsx` sekarang dianalisis memakai `ts-morph`
  untuk imports, exports, symbols, line number, exported state, dan async state.
- File source lain tetap memakai heuristic analyzer; tipe yang tidak dikenal
  memakai fallback low-confidence.
- Snapshot v1 tetap mempertahankan field lama dan menambah analyzer id,
  analysis confidence, serta symbol metadata.
- `devmap analyze` sekarang menulis `.devmap/index.json` dan satu feature map
  per fitur di `.devmap/features/`, termasuk saat snapshot cache dipakai ulang.
- Generated `DEVMAP.md` dan block `AGENTS.md` memakai urutan index, feature map,
  source priority, lalu full snapshot sebagai last resort.
- Feature detector memisahkan documentation, web landing, CLI commands,
  analysis engine, snapshot engine, dan AI integration sebelum technical
  feature attribution.
- False-positive Authentication pada source DevMap sendiri dihapus dengan
  mensyaratkan bukti path, import, atau symbol, bukan sekadar kata di content.
- Validasi manual pada root DevMap menghasilkan enam feature tanpa
  Authentication palsu; index berukuran sekitar 4.5 KB.
- Structural flows sekarang menjelaskan aksi nyata seperti scan, analyzer
  selection, ProjectMap build, snapshot persistence, dan index generation,
  bukan mengulang daftar dependency.
- Critical files pada index memprioritaskan executable entry point, feature
  entry point, dan behavioral support files; `ai/types.ts` tidak lagi masuk
  hanya karena import count tinggi.
- Full CLI suite lulus 96/96, TypeScript typecheck dan production build lulus,
  serta packed tarball E2E lulus untuk fixture Next.js dan Express.

## Update 2026-06-19

### Onboarding Command

- `devmap onboarding` ditambahkan sebagai kandidat MVP 0.1.0, dengan alias
  `devmap onboard`.
- Command membaca `.devmap/snapshot.json` dan menghasilkan guide berbasis
  snapshot tanpa membutuhkan AI call.
- Output human berisi Project Overview, Recommended Reading Path, Feature Map,
  Important Flows, Change Impact Notes, dan Agent Workflow.
- `devmap onboarding --write` menulis `ONBOARDING.md`.
- `devmap onboarding --json` menghasilkan satu dokumen JSON untuk agent,
  editor, atau script.
- README, PRD, command docs, roadmap, design docs, dan CLI README diperbarui
  supaya onboarding tidak lagi tercatat sebagai future-only command.
- Renderer onboarding direfaktor menjadi guide pemahaman untuk developer dan
  AI agent: pembuka menjelaskan tujuan project, mental model, konsep utama,
  area penting untuk dibaca, flow penting, dan rekomendasi mulai membaca.
- Default bahasa onboarding tetap English, sementara `--language id` dan prompt
  interaktif `--write` tetap dapat menghasilkan Bahasa Indonesia.

## Update 2026-06-18

### Landing Page Astro Migration

- Landing page `apps/web` dimigrasikan dari Vue 3 + Vite ke Astro + Tailwind.
- Entry point sekarang memakai `src/pages/index.astro` dan layout dasar
  `src/layouts/BaseLayout.astro`.
- Section landing tetap dipisah per komponen di
  `src/components/landing/*.astro`, dengan komentar konten lama dipertahankan
  sebagai panduan implementasi UI berikutnya.
- Struktur placeholder ditambahkan untuk `src/assets`, `src/data`, `src/lib`,
  `src/scripts`, dan `src/components/ui`, masing-masing dengan README singkat
  tentang isi folder nantinya.
- Tailwind tetap dipakai melalui `src/styles/global.css`, `postcss.config.js`,
  dan `tailwind.config.js`.
- Astro dipin ke `5.7.14` karena `astro@latest` saat ini membutuhkan Node
  `>=22.12.0`, sementara DevMap masih menargetkan Node.js 18+.
- Build web berhasil dengan `astro check && astro build`.

## Update 2026-06-17

### Snapshot Tier 1 Enrichment

- `fileIndex` sekarang menyimpan metadata navigasi Tier 1: `purpose`, `scope`,
  `featureRefs`, `searchTerms`, dan `importance`.
- Scope file diklasifikasikan berdasarkan responsibility (`api`, `ui`,
  `database`, `config`, `service`, `cli`, `test`, `docs`, `unknown`) tanpa
  mensyaratkan framework tertentu.
- Feature metadata diperkaya dengan `purpose`, `files`, `entryPoints`,
  `searchTerms`, dan `confidence`.
- Snapshot sekarang memiliki `flows` minimal untuk high-confidence features.
  Flow masih sederhana dan belum memakai call graph.
- Analyze dapat menjalankan AI enrichment batched untuk purpose/searchTerms:
  maksimal 20 file per call, fallback aman jika gagal.
- Context Builder memakai `fileIndex.searchTerms`, `feature.searchTerms`,
  `featureRefs`, `scope`, `importance`, dan `purpose` sebagai sinyal retrieval.
- Snapshot reader memberi default aman untuk snapshot lama agar `ask` tetap
  berjalan sambil user bisa regenerate snapshot.

### Ask Retrieval Strengthening (removed)

- `QuestionContext` sekarang menyimpan `expandedTerms` selain `intent`,
  `keywords`, `confidence`, `relevantFiles`, dan `topScore`.
- Context Builder dapat menjalankan query-expansion Groq ringan sebelum scoring.
  Respons harus berupa JSON array dan hanya dipakai sebagai retrieval terms.
- Expanded terms ikut ranking dengan bobot lebih rendah dari keyword langsung,
  sehingga direct match tetap mengalahkan inferred match.
- Confidence mengikuti batas eksplisit: `high` untuk skor 70+, `medium` untuk
  40+, dan `low` di bawah 40. File di bawah skor 25 tetap dikeluarkan.
- Low-confidence context tidak dikirim ke model jawaban. Command memberi
  jawaban lokal yang menjelaskan bahwa tidak ada strong match dan menyarankan
  langkah investigasi.
- Prompt `ask` sekarang mengirim `EXPANDED_TERMS` dan memperingatkan model agar
  memperlakukan expanded terms sebagai hint retrieval, bukan fakta project.
- Dokumentasi publik diperbarui untuk menjelaskan confidence, threshold,
  query expansion, dan low-confidence behavior.
- Focused tests hijau untuk context builder, ask command, dan AI prompt
  contract.

## Update 2026-06-16

### Ask Output (removed)

- Human-readable `devmap ask` (sebelum dihapus) hanya menampilkan path pada bagian
  `Relevant Files`; alasan scoring tetap tersedia di `--json`.
- Query understanding memisahkan intent umum (`add_feature`, `change`,
  `debug`, `explain`, `navigate`, `general`) dari keyword pencarian agar
  action word seperti `add`, `change`, atau `where` tidak mengganggu ranking.
- Retrieval sekarang menyimpan `confidence` (`high`, `medium`, `low`) dan
  `topScore` pada `QuestionContext`.
- Minimum relevance threshold mencegah file dengan skor lemah dikirim hanya
  karena menjadi kandidat terbaik dari hasil yang sama-sama tidak relevan.
- Jika tidak ada file melewati threshold, `relevantFiles` kosong dan `ask`
  memberi jawaban lokal low-confidence tanpa memanggil Groq.
- Context keyword extraction mengabaikan connector word English seperti `to`
  dan `in` agar file seperti `doctor.ts` tidak menang hanya karena partial
  stop-word match.
- Scoring path/export sekarang memprioritaskan exact search term dibanding
  substring match, sehingga ranking lebih stabil untuk berbagai jenis
  pertanyaan.
- Prompt `ask` sekarang meminta jawaban langsung, tidak mengulang pertanyaan,
  tidak mengulang section/sentence, dan tidak memberi contoh kode panjang
  kecuali user memintanya eksplisit.
- Prompt `ask` menerima intent generik dan diarahkan untuk memulai dari file
  atau fungsi existing yang tersedia di context sebelum menyarankan file baru.
- Context file sudah menyiapkan field future-oriented seperti `exports`,
  `topFunctions`, dan `purpose`; extraction fungsi lengkap belum masuk scope.
- Scoring kembali memakai data project map utama seperti route metadata dan
  entry points agar `ask` tetap navigation helper berbasis snapshot.
- Focused tests mencakup keyword extraction, ranking anti stop-word, output
  terminal ringkas, intent extraction generik, relevance confidence, threshold
  low-confidence, dan prompt contract.
- Verification lulus untuk `pnpm test:cli`, `pnpm build:cli`, dan
  `git diff --check`.

### Init UX Polish

- `devmap init` human-mode sekarang menampilkan DevMap welcome brand panel di
  awal command.
- Provider tidak lagi diprompt terpisah karena MVP hanya mendukung Groq.
  Output cukup menampilkan `Provider Groq`, lalu meminta Groq API key.
- Focused verification lulus untuk init dan welcome tests.

## Update 2026-06-15

### Release Hardening 0.1.0

- Versi beta pertama ditetapkan sebagai `0.1.0`.
- Metadata npm sekarang memakai deskripsi dan keyword product yang jelas.
- README package npm menjelaskan instalasi, Groq setup, command, generated
  files, agent JSON output, supported stacks, privacy, dan known scope beta.
- `CHANGELOG.md` mencatat fitur, security/privacy behavior, dan known
  limitations `0.1.0`.
- `docs/releasing.md` mendefinisikan release gates, tarball inspection, first
  npm publish, verification setelah publish, tag GitHub, dan rancangan CD.
- Launch checklist PRD disinkronkan dengan bukti automated test dan CI.
- Feedback external dan benchmarking dipindahkan menjadi post-launch beta
  validation, tanpa mengizinkan claim token savings sebelum ada hasil.

### AI Response Streaming

- AI interpretation pada `devmap analyze`
  sekarang memakai Groq server-sent events.
- Delta response direkonstruksi menjadi hasil lengkap untuk token metadata,
  snapshot persistence, dan cache.
- Output ditampilkan progresif per paragraf agar heading, list, table, wrapping,
  dan inline Markdown tetap rapi.
- Provider yang belum memiliki method streaming tetap memakai regular
  completion tanpa mengubah public command behavior.
- Retry rate limit dan model fallback tetap berjalan sebelum stream dibaca.
- `--json` sengaja tidak memakai streaming agar stdout tetap satu dokumen JSON.
- Automated test mencakup SSE yang terpecah antar-network chunk, command
  streaming, snapshot persistence, dan JSON non-streaming.
- Automated test saat ini berjumlah 65 dan seluruhnya lulus.

## Update 2026-06-14

### Agent JSON Output

- Seluruh command MVP mendukung `--json`.
- stdout JSON hanya berisi satu dokumen valid tanpa ANSI, Markdown renderer,
  bullet, separator, atau progress text.
- `analyze --json` mengembalikan snapshot project.
- `ask --json` mengembalikan answer, relevant files, model, dan token usage.
- `doctor --json` mengembalikan diagnostics dan issues terstruktur.
- `config model --json` mengembalikan model state tanpa membocorkan API key.
- `init --json` berjalan non-interaktif dan membutuhkan environment API key
  atau existing config.
- Generated `DEVMAP.md` sekarang mengarahkan AI agent memakai `--json`.

### Model Routing And Config

- Standard `devmap analyze` tetap memakai `openai/gpt-oss-20b`.
- `devmap analyze --deep` memakai `openai/gpt-oss-120b`.
- Fallback model memakai `openai/gpt-oss-20b`.
- Command `devmap config model <model>` dapat menetapkan override global tanpa
  mengubah provider atau API key.
- `devmap config model auto` mengembalikan routing default per command.

### Context Builder Token Optimization

- Pertanyaan navigasi English seperti `where` dan `find` sekarang memakai
  maksimal dua file dengan maksimal 60 baris per file.
- Test, spec, dan fixture dikeluarkan dari pertanyaan produk biasa sehingga
  dummy authentication fixture tidak lagi dianggap sebagai fitur production.
- File test dapat dipilih kembali ketika query English menyebut `test`,
  `testing`, `spec`, `fixture`, atau `coverage`.
- Scope English untuk CLI, web UI, dan documentation memberi ranking boost
  tanpa melakukan hard exclusion terhadap package lain.
- Benchmark existing tetap mencapai top-1 accuracy 20/20 dan top-3 recall
  20/20.
- Payload `where scanner` pada snapshot DevMap turun dari sekitar 20.844
  karakter menjadi 4.423 karakter sebelum tokenisasi.

### Reliability Fixes

- Groq HTTP 429 sekarang di-retry maksimal tiga kali dengan exponential
  backoff sebelum menampilkan error actionable.
- Snapshot reader memvalidasi setiap entry `fileIndex` sebelum snapshot dipakai
  oleh Context Builder.
- Config yang corrupt atau memiliki schema tidak valid diperlakukan sebagai
  config missing.
- `devmap doctor` membaca versi langsung dari package metadata.
- Marker baru `AGENTS.md` memakai kapitalisasi `DevMap`, sambil tetap mengenali
  marker legacy agar block lama tidak diduplikasi.
- Kontrak stats schema v1 didokumentasikan: `totalFiles` dan `relevantFiles`
  sama-sama menghitung hasil scanner setelah ignore filtering.
- Automated test saat ini berjumlah 47 dan seluruhnya lulus.

### Welcome Brand Panel

- Simbol logo terpisah dan border luar dihapus agar welcome screen lebih bersih.
- Terminal lebar memakai wordmark blok berpinggiran seperti identitas awal.
- Label `DEVMAP CLI`, capability line, dan separator aqua solid memperjelas
  identitas produk sebagai developer tool.
- Perbedaan render glyph Unicode pada sebagian font terminal dicatat sebagai
  known issue untuk compatibility pass berikutnya.
- Terminal lebar memakai wordmark penuh dalam area maksimal 76 kolom.
- Terminal sempit memakai judul `DEVMAP` ringkas agar panel tidak wrap atau
  terpotong.
- Renderer panel dipisahkan agar layout lebar dan sempit dapat diuji langsung.
- Automated test saat ini berjumlah 49 dan seluruhnya lulus.

### Issue-First PR Workflow

- Bug, reliability/security fix, fitur MVP, dan perubahan UX sekarang memakai
  issue GitHub sebelum PR dibuat.
- Implementasi dan verification boleh diselesaikan lokal terlebih dahulu.
- Sebelum commit, push, atau PR, agent berhenti dan memberi title/body issue
  siap pakai kepada maintainer.
- Setelah nomor issue diberikan, PR harus memakai `Closes #N` agar issue
  tertutup otomatis ketika merge.
- Perubahan dokumentasi/proses kecil, typo, dependency maintenance, dan CI
  housekeeping tidak wajib memakai issue.

## Update 2026-06-13

### Packed CLI End-to-End

- Manual tarball test pada project eksternal dengan Groq API key sudah berhasil
  dijalankan oleh maintainer.
- Script `pnpm test:package-e2e` membuat tarball CLI dari source terbaru.
- Tarball dipasang sebagai dependency pada project Next.js dan Express
  sementara, bukan dijalankan langsung dari workspace.
- E2E memverifikasi `--version`, `--help`, `analyze --fresh`, `ask`, `doctor`,
  dan isi snapshot.
- Home directory diisolasi agar config Groq pribadi tidak terbaca dan tes tidak
  memakai quota AI.
- Package smoke test di CI sekarang menjalankan alur distribusi end-to-end ini.

## Update 2026-06-12

### Analyzer Resilience

- `devmap analyze` sekarang tetap menyelesaikan static analysis ketika root
  `package.json` tidak dapat diparse.
- Framework fallback dari struktur source tetap digunakan sehingga project
  Express atau Next.js masih dapat dikenali tanpa dependency metadata.
- Snapshot menyimpan warning bahwa dependency-based detection mungkin tidak
  lengkap.
- Output terminal memberi langkah perbaikan untuk membetulkan `package.json`
  lalu menjalankan `devmap analyze --fresh`.
- Automated test mencakup warning terminal, snapshot persistence, framework
  fallback, dan keberhasilan pembuatan snapshot.

### Terminal Markdown Rendering

- Architecture interpretation dari
  `devmap analyze` sekarang dirender sebagai output terminal yang terstruktur.
- Heading memakai accent aqua dan separator.
- Marker Markdown inline seperti bold, italic, strikethrough, link, dan
  backtick tidak lagi tampil mentah.
- Ordered dan unordered list mempertahankan indentasi yang mudah dipindai.
- Markdown table diubah menjadi record vertikal agar tetap terbaca pada
  terminal sempit.
- Prose dibungkus berdasarkan `process.stdout.columns` dengan minimum width
  yang aman.
- Fenced code tetap ditampilkan sebagai source block dan static context tidak
  diproses sebagai Markdown.
- Automated test mencakup heading, inline formatting, list, table, wrapping,
  fenced code, serta integrasi `ask` dan cached `analyze`.

### Testing Guide

- `TEST.md` disusun ulang sebagai panduan testing praktis untuk maintainer.
- Panduan sekarang membedakan source tanpa build, automated test, build `dist`,
  tarball external, `npm exec`, `npm link`, AI live, dan CI/runtime testing.
- Alur tarball menjelaskan cara membuat artifact, install pada project lain,
  mengulang install setelah source berubah, expected result, dan cleanup.
- Source mode dijelaskan sebagai cara tercepat melihat perubahan terbaru tanpa
  build atau install ulang.

### Safe `AGENTS.md` Integration

- `devmap init` sekarang membuat `AGENTS.md` dasar jika file belum ada.
- Existing `AGENTS.md` tidak pernah ditimpa.
- Append DevMap instruction block hanya dilakukan setelah konfirmasi eksplisit
  `y` atau `yes`.
- Mode non-interaktif selalu skip existing `AGENTS.md`.
- Block yang sudah ada tidak ditambahkan ulang.
- Symlink `AGENTS.md` ditolak untuk mencegah write di luar project.
- Automated test pada tahap ini berjumlah 43 dan seluruhnya lulus.

## Update 2026-06-11

### Workflow Agent

- Alur branch `codex/`, commit dengan identitas `devmap-agent`, push branch, dan
  draft pull request sudah diverifikasi.

### Analyzer dan Snapshot

- Snapshot schema versi 1 sudah ditambahkan.
- Snapshot sekarang memiliki project fingerprint untuk stale detection dan
  reuse ketika source tidak berubah.
- Snapshot corrupt, missing, dan unsupported schema sudah dibedakan.
- Project metadata sekarang mencakup nama, framework, language, dan package
  manager.
- Analyzer sekarang mendeteksi routes, API routes, database, dan features.
- Critical files memakai score dan alasan, bukan hanya jumlah import.
- Test fixture dan file test tidak lagi mencemari kesimpulan framework, route,
  service, database, feature, atau entry point production.

### Context Builder

- Context Builder heuristic sudah diimplementasikan secara lokal.
- Ranking memakai path, exported symbols, imports, routes, feature evidence, dan
  critical file signals.
- Pertanyaan Bahasa Indonesia dan English didukung melalui concept aliases.
- Context dapat diperluas satu tingkat ke imported file dan importer terkait.
- Batas context adalah maksimal 5 file dan 200 baris per file.
- File besar memakai relevant line window.
- Path traversal dan symlink escape di luar project root ditolak.
- `devmap ask` (sebelum dihapus) sudah memakai Context Builder secara lokal.
- Benchmark 20 pertanyaan mencakup auth, database, route session, halaman,
  layout, payment, dan entry point dalam Bahasa Indonesia dan English.
- Hasil benchmark saat ini: top-1 accuracy 20/20 dan top-3 recall 20/20.
- Alias `nextauth` ditambahkan setelah eval menemukan satu fallback ranking yang
  salah.
- Context Builder sudah siap digunakan sebagai input AI layer.

### AI Ask

- Provider abstraction `AiClient` sudah ditambahkan.
- Groq chat completion memakai endpoint REST resmi tanpa SDK tambahan.
- Default model `ask` menggunakan production model
  `openai/gpt-oss-20b`.
- Fallback model menggunakan `llama-3.3-70b-versatile`.
- Request 429 di-retry maksimal tiga kali memakai exponential backoff dan
  header `retry-after`.
- Invalid API key, rate limit, provider failure, empty response, dan response
  yang tidak valid diterjemahkan menjadi error actionable.
- Prompt `ask` (sebelum dihapus) hanya memakai context terpilih dan meminta jawaban dalam bahasa
  yang sama dengan pertanyaan.
- `devmap ask` (sebelum dihapus) menampilkan token usage agar benchmarking dapat dilakukan.
- Jika AI belum dikonfigurasi atau gagal, selected static context tetap
  ditampilkan.
- Automated test AI memakai fake provider sehingga tidak menggunakan quota.

### AI Analyze

- Standard `devmap analyze` memakai `openai/gpt-oss-20b` ketika config bernilai
  `auto`.
- `devmap analyze --deep` memakai `llama-3.3-70b-versatile`.
- Prompt hanya mengirim compact static snapshot, bukan full raw source.
- Interpretasi arsitektur menyebut entry point, critical file, route, feature,
  database, service, dan relationship yang didukung snapshot.
- Hasil AI, model, generated time, dan token usage disimpan di snapshot.
- Project yang tidak berubah memakai cached AI interpretation tanpa API call
  baru.
- `--fresh` memaksa static analysis dan AI interpretation baru.
- Jika AI gagal, static analysis dan snapshot tetap berhasil.
- Automated test AI memakai mock provider dan tidak menggunakan quota.

### Doctor Diagnostics

- `devmap doctor` sekarang menampilkan versi DevMap, Node.js, OS/arsitektur,
  lokasi project, framework, package manager, provider, config, dan snapshot.
- Node.js di bawah versi 18 ditandai sebagai unsupported.
- Model `auto` di-resolve ke model aktual `openai/gpt-oss-20b`.
- API key divalidasi melalui endpoint daftar model Groq.
- Availability selected model ikut diperiksa.
- Snapshot dibedakan menjadi valid, missing, corrupt, dan unsupported schema.
- API key dan raw stack trace tidak pernah ditampilkan.
- Automated test saat ini berjumlah 38 dan seluruhnya lulus.

### Distribusi npm

- Package CLI publik sekarang bernama `devmap`, sedangkan root private workspace
  bernama `devmap-workspace`.
- Allowlist package hanya memasukkan `dist`; npm tetap menyertakan
  `package.json`, `README.md`, dan `LICENSE`.
- Script `prepack` selalu membangun CLI sebelum tarball dibuat.
- Source, test, `.devmap`, fixture `.env`, dan fixture `node_modules` tidak lagi
  masuk tarball.
- Tarball `devmap-0.1.0.tgz` berhasil dijalankan melalui `npm exec` untuk
  `devmap --version` dan `devmap --help`.
- GitHub Actions memiliki package smoke test setelah seluruh matrix CI lulus.

### Cross-Platform CI

- GitHub Actions matrix sudah ditambahkan untuk:
  - Ubuntu, Windows, dan macOS
  - Node.js 18, 20, dan 22
- Workspace diturunkan dari pnpm 11 ke pnpm 10.34.2 agar kompatibel dengan
  Node.js 18 dan 20.
- Frozen install, test CLI, build CLI, smoke CLI, dan build web dijalankan di CI.
- Windows Node.js 18/20 sempat gagal karena shell wildcard
  `test/*.test.ts`.
- Test runner cross-platform `packages/cli/test/run-tests.ts` sudah dibuat.
- Runner sudah diverifikasi langsung pada Windows dengan Node.js 18.20.8 dan
  20.20.2; keduanya lulus 20/20 test.

### Commit Terkait

```text
07b62d2 Add cross-platform CI with pnpm 10
745f1ed Fix test discovery on Windows
```

### Prioritas Berikutnya

1. Pastikan rerun GitHub Actions hijau pada seluruh 9 kombinasi.
2. Lakukan manual verification Groq pada project nyata.
3. Uji `init`, `analyze`, `ask`, dan `doctor` dari tarball pada project nyata.
4. Tambahkan streaming output untuk jawaban AI jika waktu MVP masih tersedia.

## Status Saat Ini

DevMap sekarang sudah disiapkan sebagai monorepo pnpm yang berjalan, dengan
fondasi CLI yang sudah fungsional. Posisi proyek masih berada di Phase 1 sesuai
roadmap: fokus ke static analysis dulu, belum masuk jawaban AI.

Saat ini CLI sudah bisa:

- Menampilkan welcome screen dengan ASCII wordmark DevMap berwarna aqua ketika
  `devmap` dijalankan tanpa command.
- Menampilkan root help `devmap --help` dengan tema aqua/gray.
- Menampilkan output command dengan warna tema yang konsisten untuk section,
  status, key-value, list item, dan catatan.
- Membuat konfigurasi lokal DevMap dengan `devmap init`.
- Menganalisis project dan menyimpan `.devmap/snapshot.json`.
- Mendeteksi source file, import, entry point, critical file, dan external service
  yang dikenal.
- Menjawab pertanyaan secara statis dengan mencari file yang kemungkinan relevan.
- Menjalankan diagnostics setup dengan `devmap doctor`.
- Menjalankan automated test terhadap fixture Next.js dan Express.
- Menyediakan landing page DevMap berbasis Vue dan Vite.
- Menangani command failure tanpa menampilkan raw stack trace.
- Menjalankan setup wizard `devmap init` dengan validasi Groq API key.
- Membuat `DEVMAP.md` sebagai panduan reusable untuk developer dan AI agent.

## Ringkasan Update

### Setup Workspace

- Root `package.json` diperbarui supaya cocok dengan workflow monorepo yang ada
  di dokumentasi.
- Script root ditambahkan:
  - `pnpm dev:cli`
  - `pnpm build:cli`
  - `pnpm test:cli`
- Root package ditandai sebagai `private` karena repo ini adalah workspace root.
- Metadata project diperbarui memakai deskripsi DevMap dan license MIT.

### Setup Package CLI

- Package CLI publik memakai nama `devmap` agar `npx devmap` bekerja.
- Entry binary `devmap` ditambahkan dan diarahkan ke `./dist/index.js`.
- Welcome screen aqua ditambahkan untuk command `devmap` tanpa argumen. Desainnya
  memakai ASCII wordmark DevMap sebagai brand signal, memakai warna truecolor
  `#2EE6D6`, lalu isi di bawahnya tetap ringkas dan command-focused.
- Script package CLI ditambahkan:
  - `pnpm --filter devmap dev`
  - `pnpm --filter devmap build`
  - `pnpm --filter devmap test`
- `commander` dipasang di versi `^12.0.0` supaya tetap kompatibel dengan
  requirement Node.js 18+ yang tertulis di dokumentasi.
- Node types ditambahkan ke `tsconfig.json` supaya TypeScript mengenali
  `process`, `console`, dan import `node:*`.
- Root help kustom ditambahkan supaya `devmap --help` mengikuti tema terminal
  DevMap, bukan output default Commander.

### Kerapian Git

- `.gitignore` ditambahkan dengan isi:
  - `node_modules/`
  - `dist/`
  - `.devmap/`
  - `.env`
  - `.env.*`
  - `*.log`
- File `node_modules/.pnpm-workspace-state-v1.json` yang sebelumnya terlanjur
  tracked sudah dikeluarkan dari tracking Git tanpa menghapus file lokalnya.
- Policy pnpm untuk build script `esbuild` ditambahkan karena dibutuhkan oleh
  `tsx`.

### Automated Testing

- Test runner memakai built-in `node:test` melalui `tsx`, sehingga tidak perlu
  menambah framework test baru.
- Script test CLI sekarang menjalankan unit/integration test dan TypeScript
  type-check:
  - `pnpm --filter devmap test`
  - `pnpm --filter devmap test:unit`
  - `pnpm --filter devmap test:types`
- Fixture Next.js mencakup:
  - App Router
  - import lokal dengan suffix `.js`
  - NextAuth
  - Prisma
  - `.env` dan `node_modules` untuk memastikan ignore rules bekerja
- Fixture Express mencakup:
  - server entry point
  - route lokal
  - Stripe
- Tujuh automated tests sudah tersedia untuk scanner, framework detector,
  dependency graph, service detector, project map, dan snapshot persistence.

### Landing Page

- Landing page DevMap sudah tersedia di `apps/web`.
- Stack web:
  - Vue 3
  - Vite
  - Vue Router
  - Tailwind CSS
- Root workspace menyediakan:
  - `pnpm dev:web`
  - `pnpm build:web`
  - `pnpm preview:web`
- Production build landing page sudah berhasil.

## File Yang Sudah Diimplementasikan

### `packages/cli/src/index.ts`

Entry point utama untuk CLI.

Tanggung jawab:

- Menampilkan welcome screen ketika user menjalankan `devmap` tanpa command.
- Menampilkan root help bertema ketika user menjalankan `devmap --help`,
  `devmap -h`, atau `devmap help`.
- Membuat command utama `devmap` menggunakan Commander.
- Mendaftarkan command MVP:
  - `init`
  - `analyze`
  - `ask`
  - `doctor`
- Menyediakan `--version` dan bantuan command.

### `packages/cli/src/utils/welcome.ts`

Renderer welcome screen untuk first-run experience.

Tanggung jawab:

- Menampilkan ASCII wordmark DevMap berwarna aqua `#2EE6D6`.
- Menampilkan tagline `Understand Any Codebase.`
- Menampilkan status snapshot project.
- Menampilkan quick start:
  - `devmap init`
  - `devmap analyze`
- Menampilkan daftar popular commands seperti `analyze`, `explain`, `ask`,
  `docs`, dan `onboard`.

### `packages/cli/src/utils/help.ts`

Renderer root help bertema.

Tanggung jawab:

- Menampilkan usage, daftar command, options, dan link repo dengan warna tema.
- Menjaga `devmap --help` tetap konsisten dengan visual terminal DevMap.

### `packages/cli/src/commands/init.ts`

Command setup awal.

Perilaku saat ini:

- Membuat `~/.devmap/config.json`.
- Mengatur Groq sebagai default provider.
- Meminta API key secara interaktif atau membaca `GROQ_API_KEY`.
- Memvalidasi API key langsung ke Groq.
- Memakai API key lama jika user menekan Enter saat config sudah tersedia.
- Mendeteksi framework project aktif.
- Membuat folder `.devmap/`.
- Memastikan `.devmap/` masuk ke `.gitignore` project aktif.
- Membuat `DEVMAP.md` tanpa menimpa file yang sudah ada.

### `packages/cli/src/ai/groq.ts`

Validator Groq untuk setup MVP.

Tanggung jawab:

- Memvalidasi API key melalui endpoint model Groq.
- Menerjemahkan invalid key, network failure, dan provider failure menjadi error
  yang actionable.

### `packages/cli/src/utils/errors.ts`

Global command error boundary.

Tanggung jawab:

- Menangkap error dari command CLI.
- Menampilkan pesan ringkas tanpa raw stack trace.
- Memberi saran tindakan berikutnya.
- Menerjemahkan error umum seperti `ENOENT`, `EACCES`, dan `EPERM`.

### `packages/cli/src/utils/prompt.ts`

Adapter prompt interaktif berbasis `node:readline/promises`.

Tanggung jawab:

- Membaca provider dan API key saat `devmap init`.
- Menutup interface input setelah wizard selesai atau gagal.

### `packages/cli/src/utils/devmapFile.ts`

Generator `DEVMAP.md`.

Isi utama file:

- lokasi snapshot dan config DevMap
- workflow `analyze`, `ask`, dan `doctor`
- panduan untuk AI agent agar memakai snapshot sebelum eksplorasi buta
- aturan untuk tidak mengedit `.devmap/`
- peringatan agar API key tidak pernah di-commit

File yang sudah ada tidak akan ditimpa.

### `packages/cli/src/commands/analyze.ts`

Command untuk analisis project secara statis.

Perilaku saat ini:

- Melakukan scan pada folder project yang ditargetkan.
- Membuat project map.
- Menampilkan nama project, framework, jumlah file, jumlah line, entry point,
  critical file, dan external service.
- Menyimpan snapshot ke `.devmap/snapshot.json`.
- Mendukung flag `--deep` dan `--fresh` di level CLI.

Output `--deep` saat ini masih sederhana dan statis. Penjelasan AI yang lebih
kaya akan masuk di Phase 2.

### `packages/cli/src/commands/ask.ts`

Command pertanyaan statis.

Perilaku saat ini:

- Membaca `.devmap/snapshot.json`.
- Jika snapshot belum ada, command menjalankan quick analyze dulu.
- Mengambil keyword dari pertanyaan user.
- Memberi skor file berdasarkan kecocokan keyword terhadap path file dan exported
  symbol.
- Menampilkan file paling relevan dan preview singkat.

Command ini belum memanggil AI. Di Phase 2, bagian jawaban statis akan diganti
dengan output Groq yang context-aware.

### `packages/cli/src/commands/doctor.ts`

Command diagnostics setup.

Perilaku saat ini:

- Menampilkan versi Node.js.
- Mengecek apakah config DevMap sudah ada.
- Mengecek apakah API key sudah diset.
- Mengecek apakah snapshot project sudah ada.
- Memberi warning jika API key Groq belum tersedia.

### `packages/cli/src/analyzers/fileScanner.ts`

Scanner filesystem rekursif.

Tanggung jawab:

- Menelusuri folder project.
- Menerapkan ignore rules.
- Membaca isi file.
- Mengembalikan path, absolute path, extension, ukuran file, jumlah line, dan
  konten file.

### `packages/cli/src/analyzers/filterEngine.ts`

Engine ignore rule untuk proses scanning.

Saat ini mengabaikan path umum yang generated atau tidak aman dikirim ke proses
analisis:

- `.git`
- `.devmap`
- `.next`
- `.turbo`
- `.vercel`
- `build`
- `coverage`
- `dist`
- `node_modules`
- `out`
- `.env*`
- file log, source map, lockfile, dan asset binary umum

### `packages/cli/src/analyzers/frameworkDetector.ts`

Detector framework.

Deteksi saat ini:

- Next.js terdeteksi dari dependency `next` atau folder `app/`.
- Express terdeteksi dari dependency `express` atau file entry server umum.
- Jika tidak cocok, hasilnya `unknown`.

### `packages/cli/src/analyzers/dependencyGraph.ts`

Builder import graph.

Tanggung jawab:

- Melakukan parsing static untuk `import`, `export from`, dan `require()`.
- Resolve import relatif lokal.
- Mendukung resolve source TypeScript ketika import memakai suffix `.js`.
- Menghitung reference antar file.

### `packages/cli/src/analyzers/entryPoints.ts`

Detector entry point.

Logika saat ini:

- Memprioritaskan source file saja.
- Mendeteksi pola entry point umum seperti:
  - `page.tsx`
  - `layout.tsx`
  - `middleware.ts`
  - `server.ts`
  - `app.ts`
  - `index.ts`
  - `route.ts`
- Juga memasukkan source file yang meng-import file lain tetapi tidak di-import
  oleh file lokal lain.

### `packages/cli/src/analyzers/serviceDetector.ts`

Detector external service.

Logika saat ini:

- Membaca dependency package dan import package yang benar-benar ada di source.
- Mendeteksi service yang dikenal seperti Prisma, Supabase, Stripe, NextAuth,
  Midtrans, Resend, Cloudinary, Firebase, OpenAI, dan Groq.
- Menghindari false positive dari teks dokumentasi atau dari file detector itu
  sendiri.

### `packages/cli/src/analyzers/projectMap.ts`

Builder project map.

Tanggung jawab:

- Mengorkestrasi scanner, graph builder, framework detector, entry detector, dan
  service detector.
- Membuat bentuk data snapshot yang dipakai oleh `analyze` dan `ask`.
- Menyimpan metadata per file:
  - hash
  - imports
  - exported symbols
  - line count

### `packages/cli/src/cache/fileHash.ts`

Utility kecil untuk hashing MD5.

Dipakai untuk mengenali perubahan konten file pada snapshot dan behavior cache
di masa depan.

### `packages/cli/src/cache/snapshot.ts`

Helper persistensi snapshot.

Tanggung jawab:

- Menulis `.devmap/snapshot.json`.
- Membaca snapshot yang sudah ada.
- Menyediakan path canonical untuk snapshot.

### `packages/cli/src/utils/config.ts`

Helper global config.

Tanggung jawab:

- Membaca `~/.devmap/config.json`.
- Menulis `~/.devmap/config.json`.
- Menyediakan path canonical untuk config.

### `packages/cli/src/utils/gitignore.ts`

Helper Git ignore.

Tanggung jawab:

- Memastikan `.devmap/` ada di `.gitignore` project.
- Menghindari duplikasi entry `.devmap/`.

### `packages/cli/src/utils/output.ts`

Helper output terminal.

Tanggung jawab:

- Menjaga output command tetap konsisten.
- Menyediakan token warna tema:
  - aqua `#2EE6D6`
  - gray
  - green
  - yellow
  - red
- Menyediakan helper untuk section, step, success message, warning, error,
  baris key-value, list item, note, dan code block.

### `packages/cli/test/analyzers.test.ts`

Automated test utama untuk fondasi static analysis.

Coverage saat ini:

- scanner mengabaikan generated path dan secret file
- deteksi Next.js dan Express
- resolve import TypeScript dengan suffix `.js`
- perhitungan reference pada dependency graph
- deteksi external service tanpa false positive
- project map Next.js dan Express
- save/read snapshot

### `packages/cli/test/init-and-errors.test.ts`

Automated test untuk setup dan error handling.

Coverage saat ini:

- konten generator `DEVMAP.md`
- perlindungan agar `DEVMAP.md` tidak tertimpa
- init melalui environment API key
- penolakan provider di luar Groq
- actionable error saat API key tidak tersedia
- error handler tidak membocorkan stack trace
- translasi error path yang tidak ditemukan

### `packages/cli/test/fixtures/`

Project kecil yang dipakai sebagai input analyzer saat test.

Fixture yang tersedia:

- `nextjs-project`
- `express-project`

### `TEST.md`

Panduan testing lokal dan development untuk maintainer.

Mencakup:

- setup environment
- automated test CLI
- development CLI tanpa build
- testing hasil build
- testing `devmap init` dan Groq API key
- testing `DEVMAP.md`
- testing error handler
- testing fixture Next.js dan Express
- testing landing page
- checklist sebelum commit
- testing global install dengan `npm link`

## Verifikasi

Pengecekan berikut sudah berhasil:

```bash
pnpm --filter devmap test
pnpm --filter devmap build
pnpm --filter @devmap/web build
node packages\cli\dist\index.js --help
node packages\cli\dist\index.js init
node packages\cli\dist\index.js analyze
node packages\cli\dist\index.js ask "where is the scanner logic"
node packages\cli\dist\index.js doctor
```

## Limitasi Saat Ini

- Integrasi AI belum diimplementasikan.
- `ask` saat ini hanya mencari file relevan dan menampilkan preview.
- `analyze --deep` saat ini masih menampilkan breakdown statis sederhana.
- Dukungan framework masih level MVP: Next.js, Express, atau unknown.
- Snapshot yang dibuat bersifat lokal dan sengaja di-ignore oleh Git.
- `devmap doctor` belum memvalidasi API key, network, dan availability model.
- Input API key interaktif belum disamarkan saat diketik.
- Test belum mencakup edge case project besar, malformed `package.json`, dan
  circular dependency.

## Rekomendasi Langkah Berikutnya

1. Samarkan input API key saat wizard interaktif.
2. Tingkatkan `devmap doctor` untuk validasi API key, network, dan model.
3. Tambahkan test untuk malformed project dan circular dependency.
4. Tambahkan abstraction AI client dan model routing.
5. Tambahkan Context Builder dengan batas 3–5 file.
6. Tambahkan prompt template untuk `analyze` dan `ask`.

## Snapshot Scanner Ignore: Agent Development Metadata

**Tanggal:** 2026-06-18

DevMap sekarang mengabaikan folder `.agent/` dan `.agents/` saat scan project.
Folder tersebut dipakai untuk metadata/skill AI agent saat development dan
tidak boleh muncul sebagai fitur produk di snapshot.

Verifikasi:

```powershell
pnpm --filter devmap exec tsx --test test/analyzers.test.ts
```

## Snapshot Function Metadata

**Tanggal:** 2026-06-18

Snapshot `fileIndex` sekarang menyimpan `topFunctions`, yaitu daftar ringkas
fungsi atau symbol kode penting beserta line number, tipe symbol, status export,
dan status async. Metadata ini menjadi fondasi untuk jawaban `ask`, onboarding,
dan flow document tanpa harus membaca raw source terlalu banyak.

Flow minimal juga mulai memakai symbol penting pada label step, sehingga flow
lebih informatif daripada sekadar daftar file.

Tahap lanjutannya menambahkan request/API flows dari route yang terdeteksi ke
dependency lokalnya. Contoh: route API dapat menghasilkan flow
`route.ts -> auth.ts -> db.ts`, yang nanti bisa menjadi bahan awal `FLOW.md`.

Tahap berikutnya menambahkan primary feature entry point, business flow ringkas,
`onboarding.recommendedPath`, dan `changeImpact` file-level. Ini sengaja masih
shallow agar snapshot lebih memahami project tanpa masuk ke symbol graph penuh.

Generated `DEVMAP.md` sekarang memiliki Agent Navigation Contract yang meminta
agent memakai snapshot-first pada implementasi saat itu. Kontrak ini kemudian
diganti pada 2026-06-20 menjadi index-first dan feature-map-first, dengan full
snapshot sebagai fallback. Agent tetap menjalankan `devmap analyze` saat output
hilang dan meminta user menjalankan `devmap init` jika belum terkonfigurasi.

Verifikasi:

```powershell
pnpm --filter devmap exec tsx --test test/analyzers.test.ts test/context-builder.test.ts
```

---

## Update 2026-07-03 — Onboarding Fase 2: Rombak OnboardingModel + modelBuilder.ts

### Completed
Branch `update-onboarding-model` telah di-merge.

**Perubahan `model.ts`:**
- Hapus 3 tipe lama: `ReadingItem`, `FlowStep`, `FlowBlock`
- Hapus `OnboardingModel` field lama: `project` block, `overview`, `mentalModel`, `mainConcepts`, `importantAreas`, `keyFlows`, `whereToStart`, `generatedBy`
- Tambah 4 tipe baru: `StartHereItem`, `FeatureSummary`, `ConceptualStep`, `KeyFlow`
- `OnboardingModel` baru: `language`, `projectName`, `tagline`, `stackLine`, `whatThisIs`, `howItWorks`, `features`, `startHere`, `generatedAt`, `isStale`

**Perubahan `modelBuilder.ts` (506 → ~470 baris):**
- Hapus 6 builder lama + 10 helpers
- Implementasi baru sesuai spec:
  - `buildTagline()` — domain-first, fallback ownership + feature, framework + feature, name fallback
  - `resolveOwnershipHint()` — AI ownershipPattern atau capability-based
  - `buildStackLine()` — max 5 items dengan separator " · "
  - `buildWhatThisIs()` — 2-4 kalimat prose domain (user POV)
  - `buildHowItWorks()` — dispatcher: CLI / auth web / public web / generic (user sebagai subjek)
  - `buildFeatureSummaries()` — 1 kalimat per feature, filter boilerplate
  - `buildStartHere()` — ordered reading list, filter non-readable files
  - Helpers baru: `resolveOwnershipHint`, `buildFeatureWhat`, `isBoilerplatePurpose`, `buildCriticalFileReason`, `isReadableSourceFile`, `capitalize`

**Perubahan `onboarding.ts` (416 → ~230 baris):**
- `buildOnboardingMarkdown()` render section baru: tagline/stack → What This Is → How It Works → What's Inside → Start Here → Key Flows → Go Deeper
- `KeyFlow[]` dibangun dari `snapshot.flows` langsung di renderer (tidak lewat model)
- "Go Deeper" statik (3 command links), tidak bergantung snapshot
- `runOnboarding()` inject `model.isStale = stale`
- `OnboardingGuide` type disederhanakan (hapus `project`, `overview`, `agentInstructions`, `entryPoints`, `criticalFiles`, dll)
- Hapus: `renderReadingAreasFromModel()`, `renderKeyFlowsFromModel()`, `getLabels()`, `OnboardingLabels`

**Verifikasi:**
- 11 onboarding tests pass
- 4 json-output tests pass (1 fixed)
- 16 pre-existing failures di test lain tidak terkait perubahan
- Branch `update-onboarding-model` pushed (tanpa PR, sesuai instruksi)

---

## Update 2026-07-04 — Onboarding Fase 4-5: Tagline Audit + Bilingual Cleanup

Branch: `update-onboarding-model` (lanjutan, tanpa branch baru)

### Completed

**Fase 4 — Audit `buildTagline()` di `modelBuilder.ts`:**
- `buildTagline()` sekarang potong `domain.summary` ke kalimat pertama (`split(/\.\s+/)`), bukan dipakai mentah
- Validasi tambahan: `snapshot.domain.summary.trim().length > 0` sebelum dipakai

**Fase 5 — Bilingual Cleanup:**
- `normalizeOnboardingLanguage()` sekarang accept `"ind"` dan `"indonesian"` sebagai alias Bahasa Indonesia
- Hapus `KeyFlow` interface dari `model.ts` (dead code — sudah tidak di-import siapapun, renderer pakai `ProjectMap["flows"]` langsung)
- Audit hardcoded English strings di `modelBuilder.ts` dan `onboarding.ts` — semua string output user sudah bilingual
- Tidak ada import tidak terpakai yang tersisa

**Verifikasi:**
- 7 onboarding-specific tests pass (all)
- 124/140 total tests pass (16 pre-existing failures tidak terkait)
- TypeScript compile `tsc --noEmit` clean (0 error)

