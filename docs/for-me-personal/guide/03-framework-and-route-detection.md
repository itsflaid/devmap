# 3. Framework & Route Detection

**Source:** `packages/cli/src/analyzers/detectors/`

Ini adalah lapisan yang mengubah tumpukan file yang di-scan menjadi "ini adalah
monorepo Next.js + Express dengan route-route ini, database ini, dan service
eksternal ini." Ada empat detector yang bekerja sama, tetapi semuanya bergantung pada satu
penjaga bersama terlebih dahulu.

## Penjaga: `isArchitectureSource()`

**Source:** `analyzers/graph/sourceScope.ts`

Sebelum ada detector yang melihat sebuah file, hampir semuanya melewati filter ini:

```ts
const NON_PRODUCTION_SEGMENTS = new Set([
  "__fixtures__", "__mocks__", "__tests__", "coverage",
  "demo", "docs", "example", "examples", "fixtures", "samples", "test", "tests"
]);

export function isArchitectureSource(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  if (segments.some((segment) => NON_PRODUCTION_SEGMENTS.has(segment))) return false;
  return !/\.(test|spec)\.[jt]sx?$/i.test(path);
}
```

Satu fungsi inilah yang membuat repo dengan folder `examples/todo-app/` tidak
terdeteksi sendiri sebagai framework apa pun yang kebetulan digunakan oleh contoh itu —
setiap segmen path yang cocok dengan set non-production menyingkirkan file dari
skoring framework, route, database, dan critical-file sama sekali. Jika DevMap
pernah salah mengklasifikasikan dirinya sendiri (atau proyek lain) karena folder demo,
fixture, atau sample, inilah tempat pertama yang harus diperiksa.

## Deteksi framework: dependency-first, file-structure kedua

**Source:** `frameworkDetector.ts`

`detectFrameworks()` mengembalikan **hingga dua** framework — satu frontend, satu
backend — bukan satu pemenang. Itu sengaja:

```ts
export function detectFrameworks(files: ScannedFile[]): DetectedFramework[] {
  // ...
  return [
    FRONTEND_FRAMEWORKS.find((framework) => detected.has(framework)),
    BACKEND_FRAMEWORKS.find((framework) => detected.has(framework)),
  ].filter(Boolean);
}
```

`FRONTEND_FRAMEWORKS = [nextjs, nuxt, sveltekit, astro, react, vue, svelte]`
dan `BACKEND_FRAMEWORKS = [nestjs, fastify, express, koa]` adalah dua daftar
berurutan berdasarkan prioritas — yang pertama cocok dalam setiap daftar menang, jadi `nextjs`
tetap mengalahkan `astro` jika sebuah proyek kebetulan memicu keduanya. Sebuah monorepo dengan
aplikasi Next.js dan API Express dalam satu scan yang sama mendapat **satu entri dari
setiap daftar**, bukan hanya yang pertama terdeteksi. `detectFramework()`
(singular) adalah wrapper tipis yang mengembalikan hanya pemenang frontend, dengan
fallback ke backend, untuk pemanggil yang hanya ingin satu label.

### Bukti dua fase, dalam urutan prioritas

**Fase 1 — dependency `package.json`.** Ini berjalan duluan dan dianggap
sebagai signal confidence tertinggi. Kasus sederhana memeriksa package yang
jelas (`next`, `nuxt`, `astro`, `fastify`, `@sveltejs/kit`,
`@nestjs/core`/`@nestjs/common`). Tiga kasus lebih hati-hati:

- **React**: hanya ditambahkan jika `react` adalah dependency *dan* penanda
  runtime nyata ada (`react-dom`, `react-scripts`, atau plugin Vite React)
  *dan* neither `next` nor `astro` juga ada — jika tidak, sebuah aplikasi Next.js
  (yang jelas bergantung pada `react`) akan dihitung ganda sebagai React biasa.
- **Vue**: meniru pola yang sama terhadap Nuxt (`vue` + plugin Vite Vue
  atau `vue-cli-service`, tetapi tidak jika `nuxt` ada).
- **Svelte**: pola yang sama terhadap SvelteKit.

**Fase 2 — heuristik file structure**, digunakan untuk menangkap proyek di mana
`package.json` hilang atau berada di level monorepo yang berbeda. Setiap
pola di sini dipilih untuk menghindari false positive tertentu — komentar
source menjelaskan alasannya secara inline, dan layak dibaca langsung
alih-alih hanya regex-nya:

| Framework | Signal file | Kenapa aman sebagai trigger mandiri |
|---|---|---|
| Next.js | `next.config.*`, atau `app/**/{page,route}.*` / `pages/_app` | Konvensi App/Pages Router khas Next.js |
| Astro | `src/pages/*.astro` | Cukup spesifik sendiri |
| Nuxt | `nuxt.config.*` | Sespisifik `next.config.*` |
| Vue | `App.vue` di root/`src/` | Cukup spesifik sendiri |
| SvelteKit | `src/routes/**/+page.svelte` | Prefix `+` khas SvelteKit |
| NestJS | `nest-cli.json` | Sespisik signal config-file lainnya |
| Express | **hanya** sebagai fallback sempit — lihat di bawah | `server.ts`/`app.ts` adalah nama file umum di Next.js dan Node vanilla juga |

Express adalah yang menarik. `server.ts`/`app.ts` adalah nama file yang terlalu umum
di berbagai framework sehingga pencocokan nama file mentah akan salah klasifikasi
banyak proyek non-Express. Jadi jalur heuristik file dibatasi
**di belakang** pengecekan dependency yang sudah berjalan:

```ts
// Express: HANYA tambahkan melalui heuristik file jika express sudah dikonfirmasi di
// package.json, ATAU — fallback sempit — jika package.json hilang sama sekali.
```

Ketika benar-benar tidak ada `package.json` yang bisa di-parse, DevMap fallback
satu tingkat lebih jauh dan memindai *konten* file untuk panggilan `express()` nyata
atau `require("express")`/`from "express"` — bukti yang cukup spesifik sehingga
file utilitas `app.ts` milik proyek Next.js sendiri tidak akan memicunya.

## Deteksi route: satu detector per framework, digabung

**Source:** `routeDetector.ts` (+ `nestRouteDetector.ts`)

`detectRoutes()` menjalankan **setiap** detector yang framework-nya benar-benar
terdeteksi dan menggabungkan hasilnya — filosofi yang sama "jangan paksa satu
pemenang" seperti deteksi framework, dan karena alasan yang sama: scan monorepo
bisa secara sah memiliki route halaman Next.js dan route API Express.

Setiap framework mendapat extractor berbasis konvensinya sendiri:

- **Next.js** — App Router (`app/**/page|route.*`) dan Pages Router
  (`pages/**`, melewati `_app`/`_document`), dengan path folder di mana pun
  di path file (tidak di-anchor ke root) khususnya agar tata letak monorepo
  seperti `apps/web/src/app/...` tercocokkan.
- **Astro** — `src/pages/**`; `.astro`/`.md`/`.mdx` adalah halaman, file
  `.ts/.js` lainnya adalah endpoint yang mengekspor `GET`/`POST`/dst. (pendeteksian
  metode berbasis export yang sama seperti route handler Next.js).
- **Nuxt** — `pages/**.vue` di root-level (limitasi v1 yang terdokumentasi: `srcDir`
  yang dikustomisasi di `nuxt.config` tidak diperhitungkan).
- **SvelteKit** — unit route adalah **folder** di bawah `src/routes/`, bukan nama
  file; hanya `+page.svelte` dan `+server.[jt]s` yang dihitung sebagai route.
- **NestJS** — satu-satunya detector yang diimplementasikan dengan AST nyata (`ts-morph`),
  bukan regex. Controller berbasis dekorator + kelas
  (`@Controller('users')` membatasi `@Get(':id')` di method), yang memang
  regex per-baris tidak bisa mengasosiasikan secara benar — kamu perlu tahu
  kelas mana yang dimiliki method yang didekorasi. Limitasi v1 yang diketahui
  disebutkan langsung di source: bentuk objek
  `@Controller({ path: '...' })` tidak ditangani, dan
  `app.setGlobalPrefix()` tidak dikomposisi ke path.
- **Express** dan **Fastify** — berbasis regex, dan keduanya menyelesaikan masalah
  yang sama lebih sulit: **router mounting**.

### Resolusi mount router/plugin (Express & Fastify)

Baik `detectExpressRoutes` maupun `detectFastifyRoutes` melakukan resolve dua pass
sehingga `app.use('/api/users', usersRouter)` dikomposisi menjadi rute `/api/users/:id`
alih-alih hanya menampilkan `/api/users` tanpa sub-path:

1. **Pass pertama** — kumpulkan panggilan method route langsung per file, *dan*
   kumpulkan pernyataan mount (`app.use(prefix, identifier)` untuk Express;
   `app.register(plugin, { prefix })` untuk Fastify).
2. **Pass kedua** — untuk setiap mount, resolusi `identifier` ke file nyata
   menggunakan **graf dependency** (`graph[mountFile]`, dibangun di bab 9) —
   hanya file yang benar-benar diimpor oleh file mount yang menjadi kandidat. Di antara
   kandidat-kandidat itu, pilih yang kontennya mengandung nama identifier
   sebagai kecocokan word boundary; jika ambigu, fallback ke "satu-satunya
   kandidat yang diimpor yang mendefinisikan method route apa pun." Jika resolusi tetap
   ambigu (lebih dari satu kandidat cocok), ia dibiarkan tanpa resolusi alih-alih
   menebak.
3. Sub-route yang sudah diresolusi mendapat prefix yang dikomposisi melalui `composeMountPath()`;
   file yang diserap ke dalam mount dikecualikan dari *juga* dipancarkan sebagai
   route mandiri (`mountedFiles` melacak ini). Sebuah Express mount yang
   tidak bisa diresolusi sama sekali tetap memancarkan route `USE` placeholder untuk
   prefix-nya, sehingga mount tidak diam-diam tak terlihat — kasus plugin Fastify yang belum
   diresolusi cukup dibuang, karena plugin tanpa route secara nyata bukan route.

Resolusi mount inilah yang membuat `detectRoutes()` secara opsional menerima
graf dependency file sebagai argumen ketiga — tanpanya, `resolveRouterTarget`
langsung mengembalikan `undefined` dan router yang di-mount hanya tidak
diekspansi.

## Deteksi database & service eksternal

**Source:** `databaseDetector.ts`, `serviceDetector.ts`

`detectDatabase()` adalah tabel signal pendek (`DATABASE_SIGNALS`) yang diperiksa
dalam urutan — Prisma, Drizzle, Mongoose, Supabase, lalu driver SQL mentah
(`pg`, `mysql2`, `better-sqlite3`, dst.) — yang pertama cocok menang, menggabungkan
pengecekan dependency dengan pola path opsional (misalnya `schema.prisma`).

`detectExternalServices()` secara struktur berbeda: alih-alih daftar lokal,
ia mengambil dari **signal registry** (bab 5) —
`SERVICES` dan `SOURCE_SERVICE_SIGNALS` — memeriksa nama package (baik
dependency yang dideklarasikan *maupun* specifier yang benar-benar diimpor, yang menangkap
package transitis tapi diimpor yang mungkin terlewatkan oleh `package.json` yang stale)
melawan `SERVICES`, lalu memindai konten file (lowercased) untuk signal string
spesifik provider melalui `SOURCE_SERVICE_SIGNALS`. Satu detail yang perlu diketahui jika
kamu sedang debugging service yang hilang/hantu: kedua scan secara eksplisit mengecualikan
file definisi registry itu sendiri
(`isServiceSignalDefinitionFile` melewati `serviceDetector.ts`/
`featureDetector.ts` dan apa pun di bawah `analyzers/registry/`) — jika tidak
DevMap yang menganalisis *source-nya sendiri* akan mendeteksi dirinya sendiri sebagai pengguna
setiap service yang hanya memiliki string literal-nya.

## Lihat juga

- Bab 5 untuk struktur registry `SERVICES` / `SOURCE_SERVICE_SIGNALS`
- Bab 9 untuk bagaimana graf dependency yang diandalkan oleh resolusi mount
  dibangun
- Bab 4 untuk ekstraksi entity, yang mengonsumsi `routes` sebagai signal fallback
  ketika tidak ada schema ORM yang ada