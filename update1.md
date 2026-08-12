# 01 — Astro: Full Route Support

**Status:** Quick win, effort terkecil dari semua update ini. Identity framework Astro
sudah kedeteksi hari ini — yang hilang cuma extraction route-nya.

**Prasyarat:** Idealnya file `00-architecture-multi-framework-detection.md` sudah
diterapkan (supaya `detectRoutes` menerima array framework). Kalau belum, file ini masih
bisa dikerjakan berdiri sendiri — tinggal tambah `if (framework === "astro")` di cabang
`detectRoutes` yang lama, tapi nanti perlu disesuaikan lagi waktu file 00 masuk.

**Target file:**
- `packages/cli/src/analyzers/detectors/routeDetector.ts`

---

## 1. Konteks

`frameworkDetector.ts` sudah bisa mendeteksi Astro (dependency `astro` di package.json,
atau fallback file heuristic `src/pages/*.astro`). Tapi `detectRoutes()` cuma punya
cabang untuk `nextjs` dan `express` — semua framework lain (termasuk `astro`) jatuh ke
`return []`. Akibatnya struktur halaman Astro (blog, docs, marketing pages di bawah
`src/pages/`) tidak pernah jadi `RouteInfo`, dan otomatis tidak pernah jadi feature lewat
`detectFrontendPageFeatures` (fungsi itu 100% generic terhadap `RouteInfo[]`, tidak peduli
asalnya dari framework mana — begitu Astro punya routes, feature detection JALAN OTOMATIS
tanpa perlu sentuh `frontendFeatureDetector.ts` sama sekali).

Satu-satunya jalur yang menyentuh file `.astro` hari ini ada di `featureDetector.ts`:
heuristic sempit untuk `src/pages/index.astro` (landing page) dan file
hero/pricing/testimonial. Itu tetap berguna dan tidak perlu dihapus — cuma tidak
mencakup struktur multi-page yang sebenarnya.

## 2. Konvensi routing Astro yang perlu di-cover

Semua di bawah `src/pages/` (Astro SELALU pakai `src/` sebagai source root — beda dari
Next.js yang support root-level `pages/` juga. Heuristic `frameworkDetector.ts` yang
sudah require `src/pages/` itu sudah benar, JANGAN dilonggarkan ke root-level `pages/`).

- `src/pages/index.astro` → `/`
- `src/pages/about.astro` → `/about`
- `src/pages/blog/index.astro` → `/blog` (strip trailing `/index`, sama seperti
  Pages Router Next.js)
- `src/pages/blog/[slug].astro` → dynamic segment, format `[slug]` — sama seperti
  Next.js
- `src/pages/blog/[...slug].astro` → rest/catch-all param, format `[...slug]`
  (perhatikan titik tiga di dalam bracket — kalau reuse regex segment matcher dari
  `toRoutePath`, pastikan pattern `[...x]` tetap tervalidasi sebagai satu segment
  dinamis, bukan ke-strip jadi kosong)
- File/folder yang diawali underscore (`_`) di dalam `src/pages/` — **exclude**, ini
  konvensi resmi Astro untuk colocate file non-route (component, util) di dalam
  `pages/`. Terapkan di level SEGMENT (`src/pages/_components/Foo.astro` harus
  ke-exclude), bukan cuma cek nama file terakhir.
- `src/pages/**/*.md` dan `**/*.mdx` — **direct page routes juga**, Astro
  mendukung markdown langsung sebagai page. Extension pattern perlu ditambah
  `\.(astro|md|mdx)$`.
- `src/content/**` (content collections) — **BUKAN route**, jangan discan sama
  sekali. Ini data source, bukan file yang menghasilkan URL langsung — routing-nya
  baru ada kalau ada file dynamic route terpisah di `src/pages/` yang query
  collection itu (file dynamic route itu sendiri sudah tercakup oleh aturan
  `[...slug].astro` di atas).

## 3. API endpoints Astro

Astro juga punya file endpoint: file `.ts`/`.js` (bukan `.astro`) di bawah
`src/pages/` yang export `GET`, `POST`, `PUT`, `DELETE`, dst — konvensinya SAMA PERSIS
dengan Next.js App Router Route Handlers. Ini artinya: helper `findHttpMethods()` yang
sudah ada di `routeDetector.ts` (dipakai untuk Next.js) bisa dipakai ulang langsung,
tidak perlu ditulis fungsi baru:

```ts
// existing helper, reuse as-is:
function findHttpMethods(content: string): string[] {
  const pattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  // ...
}
```

Route path untuk file endpoint ini pakai konvensi folder yang sama seperti page
(`src/pages/api/users.ts` → `/api/users`), `kind: "api"`.

## 4. Implementasi yang diusulkan

```ts
function detectAstroRoutes(files: ScannedFile[]): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const file of files.filter((item) => isArchitectureSource(item.path))) {
    const match = file.path.match(
      /(?:^|\/)src\/pages\/(.+)\.(astro|md|mdx|[cm]?[jt]s)$/
    );
    if (!match) continue;

    const segments = match[1].split("/").filter(Boolean);
    if (segments.some((s) => s.startsWith("_"))) continue; // exclude underscore

    const isApiFile = match[2] !== "astro" && match[2] !== "md" && match[2] !== "mdx";
    const cleanSegments = segments[segments.length - 1] === "index"
      ? segments.slice(0, -1)
      : segments;

    routes.push({
      path: toRoutePath(cleanSegments), // reuse fungsi yang sudah ada
      file: file.path,
      kind: isApiFile ? "api" : "page",
      ...(isApiFile ? { methods: findHttpMethods(file.content) } : {})
    });
  }

  return sortRoutes(routes);
}
```

Ini sketsa, bukan final — sesuaikan detail regex/edge-case waktu implementasi (misal
pastikan `.astro` file yang JUGA export `GET`/dst tidak double-counted sebagai api —
setahu spek Astro, endpoint export cuma valid di file `.ts`/`.js`, bukan `.astro`,
jadi `isApiFile` check di atas sudah cukup aman).

Daftarkan di `detectRoutes()`:
```ts
if (frameworks.includes("astro")) routes.push(...detectAstroRoutes(files));
```
(atau `if (framework === "astro")` kalau file 00 belum diterapkan)

## 5. Yang TIDAK perlu diubah

- `frameworkDetector.ts` — identity detection Astro sudah cukup baik, tidak perlu
  disentuh untuk scope file ini.
- `frontendFeatureDetector.ts`, `capabilityDetector.ts` — otomatis dapat manfaat begitu
  `routes` terisi, tanpa perubahan apapun (lihat §1).
- `AstroPreprocessor` — sudah menangani ekstraksi frontmatter dengan baik, tidak
  terkait dengan route extraction.

## 6. Test plan

Tambah fixture baru `test/fixtures/astro-project/` (mirror struktur
`test/fixtures/nextjs-project/`):
```
package.json                      (dependency: astro)
src/pages/index.astro
src/pages/blog/index.astro
src/pages/blog/[slug].astro
src/pages/_components/Card.astro  (harus ke-exclude)
src/pages/api/subscribe.ts        (export POST)
```

Assertion inti (mirror pola `test/analyzers.test.ts`):
- `detectFramework(files)` → `"astro"` (regression, harus tetap sama)
- Route count & path yang benar untuk tiap file di atas, termasuk `_components`
  ter-exclude dan `/blog/[slug]` muncul sebagai dynamic page route
- `POST /api/subscribe` muncul dengan `kind: "api", methods: ["POST"]`
- End-to-end lewat `createProjectMap()`: fitur "Blog" muncul di `snapshot.features`
  (buktikan `detectFrontendPageFeatures` benar-benar ke-trigger, bukan cuma
  `detectRoutes` doang yang di-test terisolasi)

## 7. Acceptance checklist

- [ ] `detectAstroRoutes` menangani page `.astro`/`.md`/`.mdx`, dynamic segment,
      catch-all, index-stripping, underscore-exclusion
- [ ] API endpoint file (`.ts`/`.js` dengan export GET/POST/dst) terdeteksi sebagai
      `kind: "api"` dengan methods yang benar
- [ ] `src/content/**` tidak pernah discan sebagai route
- [ ] Fixture + test baru ditambahkan dan hijau
- [ ] Fitur Astro otomatis muncul di `snapshot.features` tanpa perubahan di
      `frontendFeatureDetector.ts`
