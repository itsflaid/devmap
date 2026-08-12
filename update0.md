# 00 — Fondasi: Multi-Framework Detection Architecture

**Status:** Prasyarat arsitektural. Semua file 01–05 (Astro, Vue, Svelte, backend) idealnya
jalan DI ATAS perubahan ini. Bisa dikerjakan terpisah dari file lain, tapi kalau file lain
dikerjakan duluan tanpa ini, mereka akan mewarisi bug yang dijelaskan di bawah.

**Target file:**
- `packages/cli/src/analyzers/detectors/frameworkDetector.ts`
- `packages/cli/src/analyzers/detectors/routeDetector.ts`
- `packages/cli/src/analyzers/pipeline/projectMap.ts`
- `packages/cli/src/analyzers/pipeline/projectMetadata.ts`
- `packages/cli/src/cache/snapshot.ts` (minor, cuma cermin dari projectMetadata)

---

## 1. Masalah saat ini

`detectFramework(files)` di `frameworkDetector.ts` mengembalikan **satu** nilai `Framework`,
dipilih dari `FRAMEWORK_ORDER = ["nextjs", "express", "react", "astro"]` — first-match-wins.
Nilai tunggal ini dipassing ke `detectRoutes(files, framework)` di `routeDetector.ts`
(dipanggil sekali, di `projectMap.ts` baris ~176).

Konsekuensi konkret: project yang punya Next.js frontend **dan** Express backend sekaligus
dalam satu scan (monorepo `apps/web` + `apps/api`, atau bahkan satu package dengan kedua
dependency) — SAAT INI cuma salah satu sisi yang route-nya ke-extract, karena `nextjs`
menang duluan di `FRAMEWORK_ORDER` dan `express` gak pernah sampai ke `detectRoutes`.

`detectFrameworks(files)` (plural) sudah ada dan mengembalikan SEMUA framework yang
kedeteksi (`FRAMEWORK_ORDER.filter(...)`), tapi cuma dipakai untuk `project.frameworks`
(metadata display) di `projectMetadata.ts` — tidak drive detection yang sebenarnya.

Kalau file 01–05 cuma nambah string baru (`vue`, `svelte`, `fastify`, `nestjs`, dst) ke
skema "satu pemenang" ini, masalah yang sama akan muncul di kombinasi baru: Vue+Express,
Next.js+NestJS microservice, dll — pattern yang sangat umum di project fullstack nyata.

## 2. Desain yang diusulkan: dua kategori, satu pemenang per kategori

Alih-alih satu `FRAMEWORK_ORDER` flat, pisahkan jadi dua kategori independen:

```ts
export type FrontendFramework =
  | "nextjs" | "react" | "astro" | "vue" | "nuxt" | "svelte" | "sveltekit";
export type BackendFramework =
  | "express" | "fastify" | "nestjs" | "koa";
export type Framework = FrontendFramework | BackendFramework | "unknown";
export type DetectedFramework = Exclude<Framework, "unknown">;
```

`nuxt` dan `sveltekit` sengaja jadi nilai TERPISAH dari `vue`/`svelte` — bukan flag
tambahan. Ini konsisten dengan cara `nextjs` sudah dipisah dari `react` hari ini (Next.js
dibangun di atas React tapi dapet nilai sendiri karena behavior file-routing-nya beda).
Prinsip yang sama berlaku: deteksi `vue` HARUS exclude ketika `nuxt` terdeteksi (mirror
exclusion pattern React vs Next.js yang sudah ada di kode: `!("next" in dependencies) &&
... && "react" in dependencies`), begitu juga `svelte` exclude ketika `@sveltejs/kit`
terdeteksi.

Untuk backend, urutan prioritas dalam kategori harus taruh `nestjs` PALING TINGGI —
alasannya dijelaskan detail di file `05-backend-nestjs.md`, tapi intinya: Nest secara
default jalan di atas Express (`@nestjs/platform-express`) atau opsional Fastify
(`@nestjs/platform-fastify`), jadi sinyal Nest (`@nestjs/core`, `@nestjs/common`,
`nest-cli.json`) harus dicek dan menang SEBELUM express/fastify diputuskan sebagai
backend framework project ini.

```ts
const FRONTEND_ORDER: FrontendFramework[] =
  ["nextjs", "nuxt", "sveltekit", "astro", "react", "vue", "svelte"];
const BACKEND_ORDER: BackendFramework[] =
  ["nestjs", "fastify", "express", "koa"];
```

`detectFrameworks(files)` berubah jadi: hitung semua sinyal yang match (logic per-framework
tetap seperti pola yang ada — dependency check dulu, file-heuristic sebagai fallback),
lalu ambil MAKS satu winner dari `FRONTEND_ORDER` dan MAKS satu winner dari
`BACKEND_ORDER`, gabung jadi array (0–2 elemen untuk kasus umum). `detectFramework(files)`
(singular, tetap dipertahankan untuk backward-compat/display) jadi
`frontendWinner ?? backendWinner ?? "unknown"`.

**Catatan skala:** desain ini tetap single-winner PER KATEGORI PER SCAN. Monorepo dengan
DUA app frontend berbeda (misal `apps/marketing` pakai Astro, `apps/dashboard` pakai
Next.js) masih akan cuma dapet satu frontend winner untuk keseluruhan scan. Detection
yang benar-benar per-workspace (baca `pnpm-workspace.yaml`/`package.json#workspaces`,
scan tiap workspace secara independen) adalah perbaikan lebih besar di luar scope
update ini — catat sebagai known limitation, bukan sesuatu yang perlu diselesaikan
sekarang.

## 3. `routeDetector.ts` — terima array, bukan satu nilai

```ts
export function detectRoutes(
  files: ScannedFile[],
  frameworks: DetectedFramework[],
  graph?: Record<string, string[]>
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  if (frameworks.includes("nextjs")) routes.push(...detectNextRoutes(files));
  if (frameworks.includes("express")) routes.push(...detectExpressRoutes(files, graph));
  // ...tambahan per file 01-05: nuxt, sveltekit, astro, fastify, nestjs
  return sortRoutes(routes);
}
```

Setiap detector per-framework tetap terisolasi (masing-masing sudah filter by file
extension/pattern sendiri-sendiri), jadi menjalankan beberapa sekaligus itu aman — tidak
saling tabrakan karena beda file yang mereka lihat.

Parameter `graph` (opsional) baru ditambahkan supaya `detectExpressRoutes` bisa
resolve router yang di-mount cross-file — lihat §5 di bawah.

## 4. Wiring di `projectMap.ts` dan `projectMetadata.ts`

Di `projectMap.ts`, ganti:
```ts
const routes = detectRoutes(files, framework);
```
jadi memakai `project.frameworks` (array, sudah dihitung sebelumnya dari
`detectProjectMetadata`) dan `graph` (sudah dibangun di baris ~164, SEBELUM baris routes
ini — jadi sudah tersedia untuk dipassing):
```ts
const routes = detectRoutes(files, project.frameworks, graph);
```

**Penting:** JANGAN pakai `framework` (singular, hasil dari `project.framework`) di sini
seperti sebelumnya — nilai itu sudah melalui business logic tambahan di
`projectMetadata.ts` yang bisa override jadi `"unknown"` untuk `projectType ===
"node-cli"` atau `"library"`. Pakai `project.frameworks` (array mentah) supaya route
detection tidak ikut ke-suppress oleh logic itu.

Di `projectMetadata.ts`, `detectProjectType` perlu di-generalize dari equality check ke
membership check terhadap dua Set:
```ts
const FRONTEND_FRAMEWORKS = new Set<Framework>(
  ["nextjs", "react", "astro", "vue", "nuxt", "svelte", "sveltekit"]
);
const BACKEND_FRAMEWORKS = new Set<Framework>(
  ["express", "fastify", "nestjs", "koa"]
);
```
Pertimbangkan juga nilai `ProjectType` baru: `"fullstack"`, dipakai ketika
`frameworks` array punya elemen dari KEDUA Set sekaligus. Ini enhancement yang berguna
(binary web-app/api-service saat ini gak bisa expresskan "ini keduanya"), tapi ini
mengubah public enum `ProjectType` — putuskan dulu apakah worth breaking-change-nya
sebelum implementasi, jangan asumsikan otomatis diterima.

`cache/snapshot.ts` baris ~145-147 punya logic yang identik (dipakai untuk migrasi
snapshot lama) — cermin perubahan yang sama di sana biar konsisten.

## 5. Bonus fix: Express router-mount prefix composition

Ini bug yang sudah ada HARI INI, independen dari kerja Vue/Svelte/Astro — tapi paling
masuk akal dibenerin di file ini karena sama-sama menyentuh `detectExpressRoutes` dan
jadi fondasi test yang lebih baik buat Fastify (file 04) nanti.

**Masalah:** `detectExpressRoutes` scan tiap file independen, regex:
```ts
/\b(?:app|router)\.(get|post|put|patch|delete|options|head|use)\(\s*["'`]([^"'`]+)["'`]/gi
```
Waktu router di-mount di file lain — pattern yang SANGAT umum (controller/router-per-
resource) — prefix-nya tidak pernah digabung dengan sub-path di file yang dimount.
Fixture test yang ada sekarang (`test/fixtures/express-project`) justru mendemonstrasikan
ini secara tidak sengaja:
```ts
// src/server.ts
app.use("/payments", paymentsRouter);
// src/routes/payments.ts — TIDAK punya route method apapun di dalamnya
export const paymentsRouter = Router();
```
Assertion test yang ada (`test/analyzers.test.ts` baris ~512) mengharapkan
`apiRoutes` cuma `[{ path: "/payments", methods: ["USE"] }]` — ini mengunci behavior
LAMA sebagai "expected". Fixture ini TIDAK menguji bug-nya karena `paymentsRouter` di
file itu memang kosong. Untuk membuktikan fix-nya jalan, fixture perlu diperluas dengan
route method sungguhan di dalam router yang di-mount (lihat §6).

**Pendekatan yang diusulkan** (pakai `graph` yang sudah dipassing dari §3):
1. Jalankan first-pass scan seperti sekarang, tapi untuk match dengan method `"use"`,
   tangkap juga identifier yang di-mount — perlu regex tambahan khusus:
   `/\b(?:app|router)\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*(\w+)\s*\)/g`
   (capture group 1 = prefix path, group 2 = nama identifier router).
2. Resolve identifier itu ke file lewat `graph[currentFile]` (daftar file yang di-import
   current file, sudah resolved ke project-relative path oleh dependency graph yang ada).
3. Untuk file target itu, jalankan route-method scan yang sama (get/post/put/patch/
   delete — BUKAN use, hindari infinite nesting untuk v1), lalu gabung
   `prefix + subPath` (normalize: root `/` sub-path jadi cuma prefix itu sendiri, bukan
   `prefix + "/"`).
4. **Fallback pragmatis kalau resolusi by-identifier-name kerasa terlalu rumit untuk v1:**
   kalau `graph[currentFile]` cuma punya SATU file yang mengandung route-method match,
   anggap itu targetnya — tidak perlu match nama identifier persis. Cakup kasus umum
   (satu file mount = satu router import) tanpa perlu parsing import statement secara
   presisi. Precision penuh (match nama identifier) adalah refinement v2.

Ini bagian paling rumit di file ini — kalau dikerjakan OpenCode, minta review manual
sebelum merge, jangan auto-accept.

## 6. Test plan

Ikuti konvensi yang sudah ada di `test/analyzers.test.ts` (helper `createScannedFile`,
`node:test` + `node:assert/strict`) dan `test/frontend-feature-detector.test.ts`
(helper `buildFixture` — tulis ke temp dir, panggil `createProjectMap(projectRoot)`,
assert di `snapshot.routes`/`snapshot.features`).

Wajib ditambah:
- Test bahwa `detectFrameworks()` mengembalikan DUA elemen (satu frontend, satu backend)
  untuk project campuran — bikin fixture baru: package.json dengan `next` + `express`
  sekaligus (atau dua manifest terpisah dalam satu monorepo scan, mirror pola test
  "framework detector reports Astro in a mixed workspace" yang sudah ada).
- Test bahwa `detectRoutes` untuk project campuran itu menghasilkan route dari KEDUA
  framework, bukan cuma satu.
- Perluas `test/fixtures/express-project/src/routes/payments.ts` dengan route method
  sungguhan (misal `paymentsRouter.get("/", ...)`), update assertion di
  `test/analyzers.test.ts` baris ~512 dari `methods: ["USE"]` jadi mencerminkan
  komposisi prefix yang benar (`path: "/payments", methods: ["GET"]` atau setara,
  sesuaikan dengan hasil final implementasi).
- Test regresi: pastikan project Next.js-only dan Express-only murni (fixture yang
  sudah ada) TIDAK berubah hasilnya sama sekali — refactor ini harus 100% backward
  compatible untuk kasus single-framework.

## 7. Yang TIDAK perlu diubah

- `capabilityDetector.ts` — murni konsumsi `RouteInfo[]`, framework-agnostic. Begitu
  routes ke-populate dengan benar dari framework manapun, capability detection (CRUD,
  sharing, dll) otomatis jalan tanpa sentuhan apapun.
- `frontendFeatureDetector.ts` (`detectFrontendPageFeatures`) — juga murni konsumsi
  `RouteInfo[]` dengan `kind: "page"`, sudah generic terhadap segment mana pun.
- Preprocessor layer (`VuePreprocessor`/`SveltePreprocessor`/`AstroPreprocessor`) —
  sudah berfungsi untuk ekstraksi script, tidak terkait dengan masalah di file ini.

## 8. Acceptance checklist

- [ ] `Framework` type terpecah jadi `FrontendFramework` | `BackendFramework` | `"unknown"`
- [ ] `detectFrameworks()` bisa mengembalikan hingga 2 elemen (1 frontend + 1 backend)
- [ ] `detectRoutes()` menerima array framework + `graph` opsional, merge hasil tiap
      framework yang match
- [ ] `projectMap.ts` memasukkan `project.frameworks` (bukan `framework` singular) ke
      `detectRoutes`
- [ ] `detectProjectType` pakai Set membership, bukan literal array `.includes` /
      equality tunggal
- [ ] Express router-mount prefix composition bekerja untuk kasus mount 1-level
      (fallback heuristic minimal, identifier-match sebagai bonus)
- [ ] Semua test lama (Next.js-only, Express-only) tetap hijau tanpa perubahan assertion
- [ ] Test baru untuk kombinasi frontend+backend ditambahkan
