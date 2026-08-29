# 9. Dependency Graph & Flows

**Source:** `packages/cli/src/analyzers/graph/`, ditambah bagian
flow-generation dari `pipeline/projectMap.ts`

Dua struktur data yang terkait tapi berbeda ada di sini: **file-to-file
import graph** (siapa mengimpor siapa) dan **flows** (urutan naratif file
untuk sebuah feature atau jalur request tertentu, dibangun di atas graph
tersebut). Graph ini juga secara langsung menggerakkan `devmap map`.

## Membangun graph: `buildDependencyGraph()`

**Source:** `graph/dependencyGraph.ts`

Untuk setiap file yang di-scan, ambil import specifiernya (menggunakan
kembali `analyses[path].imports` dari chapter 2 jika tersedia, jika tidak
maka regex fallback pribadi yang bentuknya sama persis dengan yang ada di
`heuristicAnalyzer.ts`), simpan hanya yang **relatif** (yang diawali `.`
— import paket mentah tidak relevan untuk graph internal file), dan
resolusikan setiap satu ke file project yang sebenarnya via
`resolveImport()`.

Resolusi mencoba daftar suffix kandidat tetap terhadap specifier — setiap
ekstensi umum (`.ts .tsx .js .jsx .mjs .cjs .vue .svelte .astro`), lalu
daftar yang sama di bawah konvensi folder `/index.*`. Ini juga menangani
kasus "menulis ekstensi `.js` di specifier tapi file yang sebenarnya di
disk adalah `.ts`" (umum di konfigurasi TypeScript yang strict ESM) dengan
mencoba varian `.ts`/`.tsx` dari specifier yang bersuffix `.js`. Jika
tidak ada kandidat yang ada di set file yang di-scan (`localPaths`),
import di-drop secara diam-diam — graph hanya merepresentasikan edge yang
*sudah di-resolve dan ada di project*, bukan paket eksternal atau import
yang rusak.

Hasilnya, `FileGraph = Record<string, string[]>`, adalah struktur data
bersama tunggal yang dilalui oleh algoritma di hampir semua chapter lain:
deteksi entry-point, skor critical-file (chapter 1), resolusi mount
Express/Fastify (chapter 3), `devmap map`/`devmap flow` (chapter commands
4–5), dan analisis dampak perubahan (di bawah).

`countReferences(graph)` membalik jumlah edge menjadi "berapa banyak file
yang mengimpor *file ini*" — angka `referencedBy` yang digunakan langsung
di skor critical-file chapter 1.

## Entry points: konvensi dulu, orphan-with-outgoing-edges kedua

**Source:** `graph/entryPoints.ts`

```ts
const ENTRY_PATTERNS = [
  /(^|\/)page\.[jt]sx?$/, /(^|\/)layout\.[jt]sx?$/, /(^|\/)middleware\.[jt]s$/,
  /(^|\/)(server|app|index|main)\.[cm]?[jt]sx?$/, /(^|\/)route\.[jt]s$/
];
```

Sebuah file memenuhi syarat sebagai entry point jika file sumber, lulus
`isArchitectureSource` (chapter 3), dan **salah satu** dari:
- cocok dengan salah satu pola nama file konvensi framework di atas, **atau**
- tidak pernah diimpor oleh apa pun (`!imported.has(path)`) tapi *sendiri
  mengimpor* sesuatu (`graph[path]?.length > 0`) — orphan dengan outgoing
  edge adalah heuristic yang masuk akal untuk "tidak ada yang memanggil
  ini, tapi ini memanggil hal lain, jadi kemungkinan dipanggil dari luar"
  (script CLI, file cron job, dll.).

Hasil dibatasi 20 dan diurutkan secara alfabetis — list ini langsung
masuk ke `agentInstructions`/onboarding sebagai "di mana mulai membaca."

## Graph terbalik dan tree walk terbatas — fondasi `devmap map`

**Source:** `graph/dependencyMap.ts`

Dua utilitas ada secara khusus untuk membuat output tree `devmap map`
mungkin tanpa recursive tanpa batas pada cycle atau mengeluarkan tree
yang terlalu besar dan tidak terbaca untuk file hub:

**`buildReverseGraph()`** membalik `FileGraph` menjadi "siapa yang
mengimpor saya" (dependents bukan dependencies) — inilah yang membuat
tampilan "used by" bisa ada sama sekali, karena graph forward hanya
menjawab "apa yang saya impor."

**`buildBoundedTree()`** berjalan keluar dari root hingga `maxDepth` hop,
membangun pohon `MapTreeNode` bukan list datar, dengan dua mekanisme
keamanan yang sudah terpasang:

- **Penanganan cycle** — daftar `ancestors` diteruskan melalui panggilan
  recursive (bukan set visited global — setiap *branch* melacak
  ancestors-nya sendiri, jadi file yang sama boleh muncul secara sah di
  dua branch tree yang berbeda). Jika kandidat sudah ada sebagai ancestor
  di branch *saat ini*, ia dikirim sekali sebagai leaf dengan
  `isCycle: true` alih-alih diperluas lebih jauh — import cycle nyata
  (`A → B → A`) cukup umum di codebase JS/TS sehingga ini bukan edge case
  yang perlu ditangani khusus, melainkan jalur normal.
- **Pembatasan fan-out** — `DEFAULT_MAX_CHILDREN = 25`. Komentar dokumen
  menjelaskan mengapa ini ada: sebuah `types.ts` atau `utils.ts` bersama
  bisa punya fan-in yang sangat tinggi, dan tanpa pembatasan sebuah tree
  "used by" ( atau diagram Mermaid yang di-render darinya) membengkak
  menjadi ratusan node. Anak yang dipotong dihitung, bukan hanya di-drop —
  `truncatedCount` muncul sebagai baris `"… +N more"` yang kamu lihat di
  output `devmap map` (di-render oleh `renderTree()` di
  `utils/mapRenderer.ts`, chapter commands 4). Melewatkan
  `maxChildren: Infinity` (terhubung ke flag CLI `--all`) melewati
  pembatasan sepenuhnya.

`collectNodesWithinDepth()` adalah saudara list datar dari walk yang sama —
digunakan ketika peta feature membutuhkan "file mana yang disentuh oleh
batas feature ini" sebagai set yang sudah dideduplicate, bukan tree
bertingkat.

## Flows: `generateFeatureFlows()` dan `generateRequestFlows()`

**Source:** kembali ke `pipeline/projectMap.ts`

Dua flow generator, keduanya di-export untuk digunakan kembali oleh
`commands/flow.ts` (chapter commands 5) dengan opsi `limit`/confidence yang
bisa dikonfigurasi, dan keduanya dipanggil sekali dengan batasan default
yang ketat di dalam `createProjectMap` itu sendiri
(`generateMinimalFlows` — 3 feature flows dengan confidence tinggi,
5 request flows, hanya API routes) sehingga setiap snapshot selalu punya
*beberapa* data flow bahkan sebelum seseorang menjalankan `devmap flow`
secara eksplisit.

**`generateFeatureFlows()`** mengubah `businessFlow` (daftar string
naratif dari chapter 6) yang sudah dihitung untuk sebuah feature menjadi
langkah-langkah, mencoba mengasosiasikan setiap baris naratif dengan file
nyata dengan memeriksa apakah path file muncul sebagai substring di dalam
teks label. Hanya feature yang memenuhi threshold confidence *dan* punya
lebih dari satu langkah businessFlow nyata *dan* tidak memiliki placeholder
generik `"Identify files related to..."` yang disertakan.

**`generateRequestFlows()`** digerakkan oleh graph, bukan narasi: mulai
dari file route, `collectFlowFiles()` melakukan **breadth-first walk
pada dependency graph, dibatasi 5 file**, untuk menghasilkan "file-file
yang disentuh oleh jalur request ini, kira-kira berdasarkan urutan
panggilan." Label setiap langkah di-render via `renderFlowStepLabel()`,
yang menambahkan awalan `"Start with"` di langkah pertama dan `"Review"`
di setiap langkah berikutnya, menambahkan hingga 2 nama fungsi top-level
yang di-export dari entri index file tersebut sebagai petunjuk tentang
isi file yang sebenarnya.

Kedua jenis flow bisa merender diagram Mermaid via `renderMermaidFlow()` —
implementasi yang **berbeda dan lebih sederhana** dari `renderMermaid()`
di `utils/mapRenderer.ts` (chapter commands 4): ini merender rantai linear
lurus (`S1 --> S2 --> S3`, menggunakan indeks setiap langkah sebagai ID
node) karena flow secara inheren adalah urutan, bukan graph yang bebas —
versi `mapRenderer.ts` menangani daftar edge yang bebas. Keduanya tidak
dirancang untuk digabung; flow linear dan dependency graph memang bentuk
yang berbeda.

## Jalur onboarding dan dampak perubahan — dua konsumen graph lainnya

`buildOnboardingPath()` menyusun field `onboarding.recommendedPath`
(dikonsumsi oleh sistem onboarding, chapter 15, dan instruksi navigasi
`AGENTS.md`) sebagai `Set` berurutan — dokumen root yang terkenal dulu
(`README.md`, `AGENTS.md`, `DEVMAP.md`, `package.json`), lalu entry
points, lalu critical files, lalu sisanya diurutkan berdasarkan
`importance` menurun, dibatasi total 12.

`buildChangeImpact()` menghasilkan peta `changeImpact` — untuk setiap
file, feature/flow mana yang merujuknya dan file lain mana yang
bergantung padanya (`dependents`), jadi "jika saya mengubah file ini,
apa yang mungkin rusak" punya jawaban langsung per file di dalam snapshot.
Ini menggunakan `buildReverseDependencies()` pribadinya sendiri, secara
struktur mirip tapi **bukan fungsi yang sama** dengan `buildReverseGraph()`
di `dependencyMap.ts` — yang ini tidak melakukan dedupe secara inline
(mengandalkan graph itu sendiri tidak punya edge duplikat) dan secara
eksplisit mengurutkan setiap array dependents di akhir untuk output yang
deterministik. Contoh lain dari pola "ide yang sama, dua implementasi
independen" yang muncul lebih dari sekali di codebase ini — lihat chapter 4
untuk contoh lain dengan pembangunan relation.

## Lihat juga

- Chapter 1 untuk bagaimana `entryPoints` dan `references` memberi
  makan skor critical-file
- Chapter 3 untuk bagaimana graph meresolusi router mount Express/Fastify
- Chapter 6/8 untuk `businessFlow`, input naratif ke `generateFeatureFlows`
- Chapter commands 4/5 untuk bagaimana `devmap map`/`devmap flow`
  mengekspos ini di CLI
