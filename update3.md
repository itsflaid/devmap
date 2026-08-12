# 03 — Svelte & SvelteKit: Full Support

**Status:** Sama seperti Vue — framework identity 0%, infrastruktur parsing
(`SveltePreprocessor`) sudah ada dan sudah cukup baik (menangani `<script>` instance
vs `<script context="module">`).

**Prasyarat:** File `00-architecture-multi-framework-detection.md`.

**Target file:**
- `packages/cli/src/analyzers/detectors/frameworkDetector.ts`
- `packages/cli/src/analyzers/detectors/routeDetector.ts`
- `packages/cli/src/analyzers/detectors/frontendFeatureDetector.ts`

---

## 1. Framework identity detection

⚠️ **Precision penting:** nama package SvelteKit adalah `@sveltejs/kit`, BUKAN
`"sveltekit"`. Cek dependency dengan key yang benar:

```ts
if ("@sveltejs/kit" in dependencies) detected.add("sveltekit");

const hasSvelteRuntime = "@sveltejs/vite-plugin-svelte" in dependencies;
if (!("@sveltejs/kit" in dependencies) && "svelte" in dependencies && hasSvelteRuntime) {
  detected.add("svelte");
}
```

File heuristic paling reliable untuk SvelteKit bukan `svelte.config.js` (file ini bisa
juga ada di project Svelte non-SvelteKit untuk keperluan tooling/preprocess) — yang jauh
lebih spesifik adalah konvensi penamaan `+page.svelte` di `src/routes/`, karena prefix
`+` ini cuma dipakai SvelteKit, tidak ada framework lain yang pakai:
```ts
/(^|\/)src\/routes\/.+\+page\.svelte$/
```
Pakai ini sebagai signal utama untuk file-heuristic fallback (mirror pola Astro:
`src/pages/*.astro`), bukan `svelte.config.js`.

## 2. Routing — SvelteKit file-based (`src/routes/**`)

Konvensi SvelteKit beda dari Next.js/Astro/Nuxt dalam satu hal penting: unit route-nya
adalah FOLDER, bukan nama file. File di dalam folder itu pakai prefix `+` dan nama
tetap (`+page.svelte`, `+layout.svelte`, `+server.ts`, dst) — jadi path akhir diambil
dari path FOLDER-nya saja, filename `+page.svelte` di-drop sepenuhnya (tidak perlu
logic "strip index" seperti Next.js Pages Router/Astro).

```ts
function detectSvelteKitRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const file of files.filter((item) => isArchitectureSource(item.path))) {
    const pageMatch = file.path.match(/(^|\/)src\/routes\/(.*)\/\+page\.svelte$/)
      ?? (/(^|\/)src\/routes\/\+page\.svelte$/.test(file.path) ? ["", "", ""] : null);
    if (pageMatch) {
      const segments = (pageMatch[2] ?? "").split("/").filter(Boolean);
      routes.push({ path: toRoutePath(segments), file: file.path, kind: "page" });
      continue;
    }

    const serverMatch = file.path.match(/(^|\/)src\/routes\/(.*)\/\+server\.[cm]?[jt]s$/)
      ?? (/(^|\/)src\/routes\/\+server\.[cm]?[jt]s$/.test(file.path) ? ["", "", ""] : null);
    if (serverMatch) {
      const segments = (serverMatch[2] ?? "").split("/").filter(Boolean);
      routes.push({
        path: toRoutePath(segments),
        file: file.path,
        kind: "api",
        methods: findHttpMethods(file.content) // reuse — SvelteKit +server.ts export
                                                  // GET/POST/dst, sama seperti Next.js
                                                  // Route Handlers
      });
    }
  }

  return sortRoutes(routes);
}
```

Sketsa di atas belum elegan (handle root-level file secara terpisah dari nested), rapikan
waktu implementasi — intinya tetap: HANYA `+page.svelte` dan `+server.[jt]s` yang jadi
route, file lain dengan prefix `+` (`+layout.svelte`, `+layout.server.ts`,
`+page.server.ts`, `+page.ts`, `+error.svelte`) di-exclude — mereka logic pendukung
route yang sama, bukan route terpisah.

`toRoutePath` (helper yang sudah ada) otomatis sudah handle `(group)` folder — SvelteKit
punya konvensi route groups yang sama persis (`src/routes/(app)/dashboard/+page.svelte`
→ `/dashboard`, folder `(app)` tidak muncul di URL) dengan Next.js App Router, jadi
tidak perlu logic tambahan untuk ini — reuse langsung.

## 3. Svelte client routing (SPA, non-SvelteKit)

Ekosistem Svelte tidak punya SATU router dominan seperti react-router/vue-router —
lebih terpecah. Prioritaskan berdasarkan effort/value:

**`svelte-routing`** — sintaks `<Route path="/about" component={About} />` di dalam
markup `.svelte`. Ini TEKSTUAL MIRIP dengan pattern React Router v5 yang SUDAH ADA di
`CLIENT_ROUTE_PATTERNS`:
```ts
/<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?component=\{?(\w+)/g
```
Karena `findClientRoutes` scan SEMUA file secara mentah (tidak gated by framework),
pattern ini KEMUNGKINAN BESAR SUDAH match file `.svelte` yang pakai `svelte-routing`
tanpa perlu perubahan apapun. **Verifikasi ini duluan dengan test nyata** sebelum
menulis pattern baru — kalau sudah kecover, hemat kerjaan.

**`svelte-spa-router`** — sintaks beda total, object map (bukan array):
```js
const routes = { '/about': About, '/blog/*': Blog };
```
Perlu pattern baru:
```ts
/["'`](\/[^"'`]*)["'`]\s*:\s*(\w+)/g
```
⚠️ Pattern ini TERLALU GENERIC kalau berdiri sendiri — banyak object literal lain di
codebase yang kebetulan punya shape "string key mulai dari `/` : identifier". **Wajib
di-gate**: cuma jalankan pattern ini di file yang juga mengandung
`from "svelte-spa-router"` atau `require("svelte-spa-router")` — mirror gate yang
sudah dipakai untuk Express content-fallback di `frameworkDetector.ts`
(`hasExpressCallSite`), prinsipnya sama: sinyal lemah HARUS digabung dengan bukti
kontekstual sebelum dipercaya.

**`@roxi/routify`** — file-based routing (mirip Nuxt/SvelteKit), pemakaian jauh lebih
kecil di ekosistem saat ini. Skip untuk v1, catat sebagai known gap, jangan
diimplementasi kecuali ada demand jelas.

## 4. Yang TIDAK perlu diubah

- `SveltePreprocessor` — sudah baik, tidak terkait route extraction.
- `capabilityDetector.ts`, `detectFrontendPageFeatures` — otomatis dapat manfaat
  begitu `routes` terisi (sama seperti file 01/02).

## 5. Test plan

Fixture baru: `test/fixtures/svelte-project/` (SPA, uji svelte-routing DAN
svelte-spa-router sebagai dua file terpisah) dan
`test/fixtures/sveltekit-project/` (`src/routes/` dengan minimal: root `+page.svelte`,
satu dynamic `[slug]`, satu `+server.ts`, satu `+layout.svelte` yang HARUS tidak
muncul sebagai route sendiri).

Assertion inti:
- `detectFramework` → `"svelte"` vs `"sveltekit"`, exclusion jalan dengan benar
- SvelteKit: `+layout.svelte` TIDAK menghasilkan route, `+page.svelte` di folder
  dynamic (`[slug]`) menghasilkan route dengan path yang benar, `+server.ts`
  menghasilkan `kind: "api"` dengan methods yang benar
- SPA: svelte-routing pattern match (verifikasi dulu apakah perlu pattern baru atau
  tidak, sesuai §3), svelte-spa-router pattern match HANYA ketika file punya import
  dari `svelte-spa-router` (test negatif: object literal serupa TANPA import itu
  TIDAK boleh ke-match — buktikan gate-nya jalan)

## 6. Acceptance checklist

- [ ] `svelte` dan `sveltekit` (key dependency: `@sveltejs/kit`) masuk
      `FrontendFramework`, saling exclude
- [ ] SvelteKit `+page.svelte`/`+server.ts` terdeteksi benar, `+layout.svelte` dan
      file `+` lainnya ter-exclude
- [ ] Route groups `(group)` ter-handle otomatis lewat `toRoutePath` yang sudah ada
- [ ] svelte-routing pattern terverifikasi (baru atau sudah tercakup)
- [ ] svelte-spa-router pattern ter-gate oleh import check, ada test negatif yang
      membuktikan gate-nya jalan
- [ ] Fixture + test ditambahkan dan hijau
