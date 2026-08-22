# 2. Scanning & Analysis

**Source:** `packages/cli/src/analyzers/analysis/`

Inilah tempat proyek di disk menjadi data terstruktur yang bisa di-pikirkan
oleh DevMap. Dua pekerjaan terjadi di sini: memutuskan *file mana yang penting* (`fileScanner.ts`
+ `filterEngine.ts`), dan mengekstrak *apa yang berisi setiap file*
(cascade `AnalyzerRegistry`).

## Penemuan file: `scanFiles()`

`fileScanner.ts` menelusuri pohon proyek secara rekursif, menggunakan `p-limit(50)` untuk
membatasi pembacaan direktori secara bersamaan sehingga scan pohon yang sangat besar di sebelah
`node_modules` tidak menghabiskan file descriptor. Dua detail yang perlu diketahui:

- **Pengurutan tidak gratis.** Karena direktori dikunjungi secara bersamaan,
  urutan file masuk ke array output bergantung pada waktu penyelesaian I/O,
  bukan struktur direktori. `scanFiles` secara eksplisit mengurutkan ulang semua
  berdasarkan path sebelum mengembalikan:

  ```ts
  return files.sort((a, b) => a.path.localeCompare(b.path));
  ```

  Satu baris inilah yang membuat sisa pipeline bisa mengasumsikan urutan
  deterministik — termasuk `createProjectFingerprint()` (bab 1), yang kalau tidak
  akan menghasilkan fingerprint berbeda di setiap run proyek yang tidak berubah.
- **File yang tidak bisa dibaca tidak crash scan.** `readFile(...).catch(() => "")`
  artinya file yang ditolak aksesnya atau file biner sampah menjadi string kosong
  alih-alih membatalkan seluruh analisis.

## Apa yang diabaikan: `filterEngine.ts`

`shouldIgnorePath()` menggabungkan empat filter independen, diperiksa dalam
urutan ini (paling ringan/paling umum dulu):

1. **Nama direktori hardcoded** — `IGNORED_DIRECTORIES`: yang jelas-jelas
   (`node_modules`, `.git`, `dist`, `build`, `coverage`) ditambah cache build
   framework (`.next`, `.turbo`, `.astro`, `.svelte-kit`, `.nuxt`, `.output`)
   dan `venv`/`__pycache__` milik Python.
2. **Lockfile hardcoded** — `IGNORED_FILES`: lockfile dari setiap package manager utama
   (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
   `bun.lock(b)`). Ini ukurannya besar dan tidak menambah nilai analisis.
3. **Aturan pola** — `.env*` di mana pun di path, apa pun di bawah
   `public/assets/`, dan `*.min.js`/`*.min.ts`.
4. **`.gitignore` dan `.git/info/exclude` milik proyek sendiri**, dimuat sekali
   per root proyek dan di-cache di level modul `Map` (`gitignoreCache`) sehingga
   panggilan berulang selama satu scan tidak membaca ulang dan mengurai ulang file.

Filtering berbasis ekstensi (`IGNORED_EXTENSIONS`) terpisah dan mencakup
format biner/generate (gambar, font, `.wasm`, `.map`, `.log`) tanpa
peduli direktori.

Jika kamu mau DevMap melewati sesuatu yang spesifik proyek, `.gitignore`
milik proyek hampir selalu tuas yang tepat — DevMap sengaja tidak
membuat format ignore-file kedua.

## Cascade analyzer: `AnalyzerRegistry`

`analyzeFiles()` (di `pipeline/analyzerRegistry.ts`) menjalankan setiap file yang di-scan
melalui tiga analyzer **dalam urutan prioritas**, yang pertama menang:

```ts
const registry = new AnalyzerRegistry([
  new TsMorphAnalyzer(),
  new HeuristicAnalyzer(),
  new FallbackAnalyzer()
]);
```

`AnalyzerRegistry.analyze()` memanggil `supports(file)` pada setiap analyzer
secara bergantian; yang pertama mengembalikan `true` mendapat giliran menganalisis file. Jika
analyzer itu *melempar error* saat parse (sumber yang formatnya salah), registry diam-diam lanjut
ke yang berikutnya alih-alih gagalkan seluruh file:

```ts
for (const analyzer of this.analyzers) {
  if (!analyzer.supports(file)) continue;
  try {
    return await analyzer.analyze(file, context);
  } catch {
    // lanjut ke analyzer berikutnya
  }
}
```

Inilah kenapa satu file `.ts` yang secara sintaksis rusak degradasi menjadi
entri fallback `confidence: "low"` alih-alih crash `devmap analyze`
untuk seluruh proyek.

### Tier 1 — `TsMorphAnalyzer` (`confidence: "high"`)

Didukung oleh API compiler TypeScript yang nyata (`ts-morph`), menggunakan
`Project` **in-memory** (`useInMemoryFileSystem: true`) sehingga tidak ada yang menyentuh
disk selain pembacaan awal. Ia menangani `.ts/.tsx/.js/.jsx` secara native, dan
tiga format lagi melalui langkah **preprocessor** (di bawah): `.vue`,
`.svelte`, `.astro`.

Untuk setiap file ia mengekstrak:
- **Imports** — dari deklarasi `import`, clause re-export `from`, *dan*
  panggilan `require(...)` (sehingga file CommonJS tidak menjadi titik buta)
- **Exports** — melalui `getExportedDeclarations()`
- **Symbols** — deklarasi fungsi, kelas (beserta method-nya),
  interface, type alias, enum, dan deklarasi `const`, masing-masing dengan nomor
  baris, flag exported, dan flag async
- **Top functions** — daftar simbol yang sama yang difilter ke
  function/const/class/method, diurutkan (exported duluan, lalu nomor baris),
  dibatasi di 8

Satu instance `Project` digunakan ulang di seluruh run (tidak dibuat ulang per
file) — setiap panggilan `analyzeSource` menambahkan source file, dan source file
secara eksplisit dihapus setelahnya (`this.project.removeSourceFile(...)`) untuk
menghindari pertumbuhan memori selama scan besar.

### Langkah preprocessor — bagaimana `.vue`/`.svelte`/`.astro` sampai ke `ts-morph`

`ts-morph` hanya mengurai JS/TS murni. Vue, Svelte, dan Astro semua menanamkan script
di dalam format file yang lebih besar, jadi masing-masing mendapat extractor kecil
(`analysis/preprocessors/`) yang mengimplementasikan:

```ts
interface LanguagePreprocessor {
  readonly extensions: string[];
  extract(content: string, filePath: string): ExtractedScript | null;
}
```

| Preprocessor | Mengekstrak | Catatan |
|---|---|---|
| `VuePreprocessor` | blok `<script>`/`<script setup>` pertama | Juga mencakup Nuxt — format SFC identik. Mendeteksi `lang="ts"`; output TS di-parse sebagai `.tsx` karena file TS Vue sering merujuk template ref seperti JSX. |
| `SveltePreprocessor` | `<script>` instance, fallback ke `<script context="module">` | Juga mencakup SvelteKit. Lebih memilih instance script karena di sanalah deklarasi props/reactive berada. |
| `AstroPreprocessor` | blok frontmatter yang dibatasi `---` | Frontmatter selalu diperlakukan sebagai TypeScript — tidak ada atribut `lang` di sintaks Astro. |

Jika `extract()` mengembalikan `null` — sebuah `.vue` yang hanya template tanpa `<script>`,
sebuah `.astro` yang hanya markup tanpa frontmatter — itu diperlakukan sebagai kasus
**valid yang diharapkan**, bukan error: `TsMorphAnalyzer` mengembalikan hasil kosong
`confidence: "medium"` alih-alih lanjut ke
`HeuristicAnalyzer` (bahkan tidak mendaftarkan ekstensi ini sebagai yang didukung,
lihat di bawah).

Setiap `ExtractedScript` juga membawa `lineOffset`, sehingga nomor baris yang dilaporkan
di simbol pada akhirnya bisa dipetakan ulang ke koordinat file asli
alih-alih koordinat potongan yang diekstrak.

### Tier 2 — `HeuristicAnalyzer` (`confidence: "medium"`)

Mencakup bahasa yang tidak perlu disentuh `ts-morph`:
`.cjs .cs .cts .go .java .mjs .mts .php .py .rb`. Ini murni regex —
import specifier melalui satu pola luas yang mencocokkan `import`/`export ... from`/
`require(`, dan simbol melalui satu regex per jenis deklarasi (function, const,
class, interface, type, enum), masing-masing menangkap name/line/exported/async.

Komentar kode secara eksplisit menyatakan ini adalah solusi sementara:

```ts
// TODO: Replace regex-based analysis for non-JS languages with tree-sitter
// grammars post-MVP. Current regex approach covers import/export detection
// well enough for MVP scope, but won't handle scope-aware analysis (e.g.
// distinguishing code from comments in Python).
```

Perlu diketahui jika kamu sedang debugging ekstraksi simbol yang aneh di file `.py`
atau `.go` — regex tidak punya konsep "di dalam komentar" atau "di dalam
string," jadi false positive di sana adalah keterbatasan yang diketahui dan diterima alih-alih
bug yang perlu dikejar.

### Tier 3 — `FallbackAnalyzer` (`confidence: "low"`)

`supports()` selalu mengembalikan `true` — ini jaring pengaman yang mendaratkan
setiap file lain (dan setiap kegagalan analyzer). Ia mengembalikan `FileAnalysis`
yang sepenuhnya kosong: tanpa import, tanpa export, tanpa simbol. File tetap
di-scan, di-hash, dan dimasukkan ke indeks file (bab 1) — ia hanya
tidak menyumbang signal struktural ke deteksi fitur atau graf
dependency.

## Bentuk output: `FileAnalysis`

Setiap analyzer, tanpa mempedulikan tier, mengembalikan bentuk yang sama:

```ts
type FileAnalysis = {
  analyzer: string;                 // "ts-morph" | "heuristic" | "fallback"
  confidence: "high" | "medium" | "low";
  imports: string[];
  exports: string[];
  symbols: SymbolInfo[];
  topFunctions: FunctionInfo[];
  routes?: RouteInfo[];             // diisi nanti, bukan oleh analyzer itu sendiri
};
```

Bentuk seragam inilah yang membuat semua yang ada di downstream — graf
dependency (bab 9), deteksi fitur (bab 6), deteksi route (bab 3) — tetap
tidak peduli analyzer mana yang menghasilkan data file tertentu. Konsumen bercabang
pada `confidence` saat itu penting (misalnya lebih memilih bukti high-confidence untuk
kecocokan fitur) tetapi selain itu tidak pernah perlu tahu tier mana yang berjalan.

## `FileRole` — klasifikasi independen kedua

`fileRole.ts` mengklasifikasikan setiap file ke dalam `FileRole`
(`test | documentation | config | landing-ui | cli-command | api-handler |
service | middleware | repository | ui-component | ai-integration |
application-source`) menggunakan pencocokan pola path/nama file murni — **tanpa**
bergantung pada `FileAnalysis` sama sekali.

Ini sengaja merupakan klasifikasi yang *berbeda* dari `FileScope` yang
kamu lihat di bab 1 (`api | ui | database | ...`). `FileScope` adalah tag kasar
yang dihitung sekali di dalam `projectMap.ts` untuk filtering tingkat atas. `FileRole` adalah
classifier bergranulasi lebih halus, berbasis path yang sangat dikonsumsi oleh mesin
deteksi fitur (bab 6) untuk menjawab "apakah file ini bukti yang secara arsitektural bermakna,
atau apakah ia noise (test, dok, file config)?" melalui
`isTechnicalFeatureSource()`. Kedua sistem bertumpang tindih dalam tujuan tetapi bukan
jalur kode yang sama — jangan asumsikan mengubah salah satunya mengubah yang lain.

Prioritas role diperiksa dari atas ke bawah, yang pertama cocok menang — komentar doc
di puncak file menyatakan urutannya secara eksplisik:

```
test → documentation → config → landing-ui → cli-command
  → api-handler → service → middleware → repository
  → ui-component → ai-integration → application-source
```

Perhatikan bahwa `ui-component` berfungsi ganda sebagai penangkap untuk file `.tsx/.jsx/.vue/`
`.svelte/.astro` apa pun yang tidak cocok dengan role yang lebih spesifik sebelumnya —
itulah kenapa ia harus berjalan *setelah* `api-handler`, `landing-ui`, dan
`cli-command`, bukan sebelum.

## Lihat juga

- Bab 1 untuk bagaimana urutan deterministik `scanFiles` memberi makan
  `createProjectFingerprint`
- Bab 6 untuk bagaimana `isTechnicalFeatureSource()` (dibangun di atas `FileRole`) memfilter
  bukti selama deteksi fitur
- Bab 4 untuk bagaimana `supports()`/pola cascade extractor (bentuk sama dengan
  `AnalyzerRegistry`) digunakan ulang untuk ekstraksi entity