# 10. Frontend Page Features

**Source:** `packages/cli/src/analyzers/detectors/frontendFeatureDetector.ts`

Aplikasi berbasis page bisa memiliki feature nyata yang dilihat pengguna
dengan **nol keberadaan di database** — halaman pembaca Quran, bagian FAQ
statik, layar pengaturan. Deteksi feature berbasis entity (chapter 6)
tidak akan pernah menemukan ini sendirian. Detector ini ada secara khusus
untuk mengisi celah tersebut, baik untuk file-based routing
(Next.js/Nuxt/SvelteKit) maupun client-side routing
(React Router/Vue Router/svelte-spa-router).

## Mengapa ini harus berjalan tanpa syarat, bukan sebagai fallback

Komentar dokumen pada `detectFrontendPageFeatures` menjelaskan bug nyata
yang diperbaiki ini, layak dibaca secara utuh karena merupakan contoh
bagus tentang bagaimana fallback chain extractor (chapter 4) bisa
menghasilkan hasil yang salah secara subtil:

> Entity-derived features hanya berjalan sebagai fallback chain yang
> berhenti pada sumber non-kosong pertama. Sebuah project yang punya
> minimal satu Prisma model (misalnya tabel `Session` NextAuth) tidak
> akan pernah mencapai route-hint fallback, jadi feature yang hanya
> berupa halaman seperti "Quran" atau "Dzikir" — yang tidak punya
> keberadaan di database sama sekali — tidak pernah muncul.

Dengan kata lain: sebuah project bisa punya database (sehingga
`extractEntities` mengembalikan non-kosong di tier Prisma dan tidak
pernah jatuh ke route-hints), sementara tetap memiliki bagian-bagian
aplikasi yang merupakan halaman murni frontend tanpa tabel yang
sepadan. Detector ini berjalan **setiap kali**, tanpa syarat, merge
bersama feature entity/capability yang sudah ada — ini bukan bagian dari
fallback chain extractor sama sekali.

## Pengelompokan berdasarkan path segment tingkat atas

Kedua detector (berbasis file dan client-side) mengikuti pola yang sama:
kelompokkan route yang cocok berdasarkan **path segment pertama**, treats
setiap kelompok sebagai kandidat feature, namai dengan helper
`singularize()` yang sama dari chapter 4 (`"reports"` → `"Report"`), dan
temukan file mana yang "dimiliki" oleh segment tersebut melalui aturan
reachability bersama.

**`detectFrontendPageFeatures()`** mengelompokkan route jenis page
(chapter 3) berdasarkan segment, melewati path root, segment yang murni
dinamik (`/[locale]`), dan daftar pengecualian singkat —
`NON_FEATURE_PAGE_SEGMENTS` (`auth`, `oauth`, `callback`, `api`, `static`,
`assets`, `public`). Komentar secara eksplisit membandingkan ini dengan
daftar pengecualian yang lebih *luas* yang digunakan deteksi capability
(`NON_RESOURCE_SEGMENTS`, chapter 7): halaman bernama `"settings"` atau
`"profile"` adalah tujuan nyata dan bermakna yang dinavigasi pengguna,
jadi mereka tetap dipertahankan di sini meskipun kata-kata yang sama
dikecualikan sebagai nama *resource* CRUD di tempat lain. Masalah yang
terlihat sama, jawaban yang benar berbeda tergantung konteks.

## Client-side routing: lima pola regex, satu per konvensi

**`findClientRoutes()`** tidak punya konvensi folder untuk diandalkan —
untuk SPA, route didefinisikan *dalam kode*, sebagai JSX atau objek
config. Karena tidak ada AST yang disediakan framework untuk "definisi
route" seperti yang ada untuk konvensi file Next.js, ini adalah pattern
matching atas lima pola yang sudah dikenal, yang didokumentasikan langsung
di konstanta:

```ts
const CLIENT_ROUTE_PATTERNS = [
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?element=\{<(\w+)/g,       // React Router JSX (element)
  /<Route\s+[^>]*?path=["'`]([^"'`]+)["'`][^>]*?component=\{?(\w+)/g,    // React Router JSX (component)
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?element:\s*<(\w+)/g,            // React Router data config (element)
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?Component:\s*(\w+)/g,           // React Router data config (Component)
  /\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*(\w+)\s*[,}]/g,    // Vue Router (identifier form)
];
```

Ditambah dua lagi yang ditangani secara terpisah: bentuk **lazy-import
Vue Router** (`component: () => import("./views/About.vue")`, ditangkap
sebagai relative specifier alih-alih identifier) dan bentuk object-map
**svelte-spa-router** (`{ '/about': About }`) — yang terakhir hanya
diaktifkan jika sebelumnya ditemukan import `from "svelte-spa-router"` di
file yang sama, karena bentuk `{ "/path": Identifier }` yang mentah
terlalu generik untuk dipercaya sebagai definisi route sendirian.

Semua ini secara eksplisit didokumentasikan sebagai pattern-matching
konvensi umum, bukan parser JSX/AST — filosofi trade-off yang sama dengan
ekstraksi nama tabel SQL di chapter 4. Satu keterbatasan yang disebut:
pola mengasumsikan `path` muncul sebelum `element`/`component` di
atribut JSX, yang merupakan idiomatis tapi tidak dipaksakan oleh
framework — urutan atribut yang terbalik adalah miss v1 yang diketahui.

### Meresolusi identifier atau specifier kembali ke file nyata

Kecocokan route hanya memberikan identifier (`"QuranPage"`) atau, untuk
bentuk lazy-import, relative specifier (`"./views/About.vue"`) — keduanya
bukan path file secara langsung. Dua resolver berbeda menangani dua kasus:

- **`resolveRouteComponentFile()`** — untuk identifier: cari apa yang
  diimpor oleh file pendefinisian (`fileGraph[route.definedIn]`, sebuah
  edge dari dependency graph, chapter 9, yang sudah dihitung) dan temukan
  import yang stem nama filenya cocok dengan identifier secara
  case-insensitive. Ini lookup terhadap data yang sudah di-resolve, bukan
  resolusi import baru.
- **`resolveRouteSpecifierFile()`** — untuk bentuk lazy Vue Router:
  specifier adalah path import relatif yang nyata, jadi dinormalisasi
  terhadap direktori file pendefinisian dan diperiksa terhadap daftar
  kandidat ekstensi/index-file yang sama yang digunakan
  `dependencyGraph.ts` untuk import biasa (chapter 9) — tentu saja ini
  implementasi terpisah di sini karena path ini tidak pernah melewati
  pemindaian import `buildDependencyGraph` sama sekali (ini di dalam
  literal objek route-config, bukan pernyataan `import` tingkat atas).

## Kepemilikan: aturan yang lebih ketat dari "reachable"

**`collectOwnedFiles()`** adalah bagian yang menarik, dan digunakan secara
identik di kedua detector (berbasis file dan client-side) karena
pertanyaannya sama: diberikan set file seed (file route/page itu sendiri),
file-file mana yang sebenarnya *dimiliki* oleh feature ini, berbeda dari
yang hanya *digunakan*?

Aturannya: file yang reachable hanya dianggap dimiliki jika **semua file**
yang mengimpornya *juga* berada di dalam set reachable:

```ts
const hasExternalReferrer = referrers.some((referrer) => !reachable.has(referrer));
if (!hasExternalReferrer) owned.add(file);
```

Komponen yang hanya diimpor oleh halaman feature ini dimiliki. Komponen
`Button` bersama yang diimpor oleh sepuluh halaman berbeda di seluruh
aplikasi **bukan** — meskipun secara teknis reachable dari entry point
feature ini, ia punya "external referrer" (setiap halaman lain yang juga
mengimpornya), jadi tetap di luar. Komentar dokumen menyatakan bias
desain secara eksplisit: false-negative (feature terlihat lebih kecil dari
seharusnya) lebih disukai daripada false-positive (feature mengklaim file
bersama yang sebenarnya tidak dimilikinya) — peta feature yang under-scope
menyesatkan dengan cara yang minor; peta yang over-scope yang mengklaim
infrastruktur bersama menyesatkan dengan cara yang aktif membingungkan
"apa yang perlu saya sentuh untuk mengubah feature ini."

## Lihat juga

- Chapter 6 untuk di mana hasil ini di-merge (sumber evidence keempat
  `detectFeatures`)
- Chapter 9 untuk `buildReverseGraph`, digunakan kembali di sini untuk
  pengecekan kepemilikan
- Chapter 4 untuk `singularize()`, digunakan bersama dengan penamaan
  entity/route-hint
- Chapter 7 untuk mengapa daftar pengecualian page-segment di sini secara
  sengaja lebih sempit dari daftar pengecualian resource deteksi capability
