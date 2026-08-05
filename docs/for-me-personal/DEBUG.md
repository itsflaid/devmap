# Catatan Debugging DevMap

Terakhir diperbarui: 2026-08-05

Dokumen ini menyimpan masalah teknis yang pernah ditemukan selama development
DevMap. Tujuannya supaya penyebab, solusi, dan cara verifikasinya tidak perlu
dicari ulang ketika masalah serupa muncul.

## Format Catatan

Setiap catatan berisi:

- **Gejala**: error atau perilaku yang terlihat.
- **Akar masalah**: penyebab teknis sebenarnya.
- **Solusi**: perubahan yang dilakukan.
- **Verifikasi**: cara memastikan solusi bekerja.
- **Pelajaran**: aturan yang perlu diingat.

---

## 1. pnpm 11 Tidak Kompatibel dengan Node.js 18 dan 20

**Tanggal:** 2026-06-11

### Gejala

DevMap menargetkan Node.js 18, 20, dan 22, tetapi workspace memakai pnpm 11.
Konfigurasi ini berisiko gagal ketika GitHub Actions menjalankan Node.js 18 atau
20.

### Akar Masalah

pnpm 11 membutuhkan Node.js 22 atau lebih baru. Artinya, requirement DevMap
`Node.js 18+` bertentangan dengan package manager yang digunakan untuk install
dependency.

### Solusi

- Turunkan package manager workspace ke `pnpm@10.34.2`.
- Tambahkan field berikut pada root `package.json`:

```json
{
  "packageManager": "pnpm@10.34.2",
  "engines": {
    "node": ">=18"
  }
}
```

- Tambahkan `engines.node` pada package CLI dan web.
- Regenerasi `pnpm-lock.yaml` menggunakan pnpm 10.
- Hapus dependency pnpm 11 yang sebelumnya ikut tersimpan di lockfile.

### Verifikasi

```powershell
$env:CI="true"
npx pnpm@10.34.2 install --frozen-lockfile
npx pnpm@10.34.2 test:cli
npx pnpm@10.34.2 build:cli
npx pnpm@10.34.2 build:web
```

Frozen install, test CLI, build CLI, dan build web berhasil.

### Pelajaran

Requirement Node.js aplikasi harus cocok dengan requirement package manager.
Jangan hanya menguji versi Node yang sedang terpasang di komputer lokal.

---

## 2. `devEngines` Membuat Command npm Gagal

**Tanggal:** 2026-06-10

### Gejala

Command npm seperti berikut gagal sebelum mengakses registry:

```powershell
npm view devmap
```

Error yang muncul:

```text
EBADDEVENGINES
Invalid name "pnpm" does not match "npm" for "packageManager"
```

### Akar Masalah

Root dan package CLI memakai `devEngines.packageManager` yang memaksa package
manager bernama pnpm. Ketika command dijalankan melalui npm, npm menolak
melanjutkan proses.

Ini tidak cocok untuk package CLI yang nantinya dipasang dengan:

```powershell
npm install -g devmap
npx devmap
```

### Solusi

- Hapus `devEngines.packageManager`.
- Gunakan field standar `packageManager` hanya pada workspace root.
- Gunakan `engines.node` pada package yang akan dipublikasikan.

### Verifikasi

Pastikan npm tidak lagi berhenti karena `EBADDEVENGINES`.

### Pelajaran

Package yang akan dipublikasikan ke npm tidak boleh mewajibkan user memakai
pnpm. pnpm hanya kebutuhan development workspace.

---

## 3. GitHub Actions Windows Node 18/20 Tidak Menemukan Test

**Tanggal:** 2026-06-11

### Gejala

GitHub Actions matrix menghasilkan:

- Ubuntu Node 18/20/22: lulus.
- macOS Node 18/20/22: lulus.
- Windows Node 22: lulus.
- Windows Node 18/20: gagal.

Error pada step `Test CLI`:

```text
Could not find 'D:\a\devmap\devmap\packages\cli\test\*.test.ts'
```

Script yang digunakan:

```json
{
  "test:unit": "tsx --test test/*.test.ts"
}
```

### Akar Masalah

Wildcard `test/*.test.ts` tidak di-expand secara konsisten oleh shell Windows.
Pada Node.js 18 dan 20, path tersebut diteruskan sebagai teks literal kepada test
runner.

Node.js 22 dapat menangani pola tersebut, sehingga masalah hanya terlihat pada
Windows Node 18 dan 20.

### Solusi

Buat runner cross-platform:

```text
packages/cli/test/run-tests.ts
```

Runner membaca isi folder test menggunakan `readdir()`, memilih file dengan
suffix `.test.ts`, mengurutkannya, lalu meng-import setiap file.

Script diubah menjadi:

```json
{
  "test:unit": "tsx test/run-tests.ts"
}
```

### Verifikasi

Runner diuji langsung pada Windows menggunakan Node.js 18 dan 20:

```powershell
npx -p node@18 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
npx -p node@20 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
```

Hasil keduanya:

```text
tests 20
pass 20
fail 0
```

Commit perbaikan:

```text
745f1ed Fix test discovery on Windows
```

### Pelajaran

Jangan mengandalkan shell glob untuk script npm yang harus berjalan lintas OS.
Gunakan Node.js untuk menemukan file secara eksplisit.

---

## 4. Analyzer Salah Mendeteksi Framework dari Test Fixture

**Tanggal:** 2026-06-10

### Gejala

Ketika DevMap menganalisis repository DevMap sendiri, hasilnya salah:

```text
Framework: express
Routes: /payments
External Services: NextAuth, Prisma, Stripe
```

Padahal Express, route payment, NextAuth, Prisma, dan Stripe tersebut hanya ada
di dalam fixture automated test.

### Akar Masalah

Framework detector, route detector, service detector, database detector, feature
detector, dan entry point detector membaca seluruh file hasil scanner tanpa
membedakan source production dan fixture/test.

### Solusi

- Tambahkan `sourceScope.ts`.
- Buat fungsi `isArchitectureSource()`.
- Keluarkan path berikut dari bukti arsitektur:
  - `test/`
  - `tests/`
  - `fixtures/`
  - `__tests__/`
  - `__fixtures__/`
  - file `*.test.*`
  - file `*.spec.*`
  - dokumentasi
- Terapkan scope tersebut pada seluruh detector yang menghasilkan kesimpulan
  arsitektur.

File test tetap dapat masuk scanner dan dependency graph bila dibutuhkan, tetapi
tidak digunakan untuk menyimpulkan framework atau feature production.

### Verifikasi

Setelah diperbaiki, analisis repository DevMap menghasilkan:

```text
Framework: unknown
Routes: None detected
External Services: None detected
```

Entry point fixture juga tidak lagi muncul pada hasil utama.

### Pelajaran

Scanner dan architectural evidence adalah dua konsep berbeda. Sebuah file boleh
dipindai, tetapi belum tentu boleh dipakai untuk menyimpulkan arsitektur
production.

---

## 5. Snapshot Lama Tidak Memiliki Kontrak yang Aman

**Tanggal:** 2026-06-10

### Gejala

Snapshot awal belum memiliki:

- schema version;
- project fingerprint;
- validasi required fields;
- perbedaan antara snapshot missing, corrupt, dan unsupported.

`readSnapshot()` langsung melakukan `JSON.parse()` lalu type cast.

### Akar Masalah

Snapshot diperlakukan sebagai object TypeScript terpercaya, padahal file JSON
dapat rusak, diedit manual, atau berasal dari DevMap versi lain.

### Solusi

- Tambahkan `version: "1"`.
- Tambahkan project `fingerprint`.
- Tambahkan `inspectSnapshot()` dengan status:
  - `missing`
  - `valid`
  - `corrupt`
  - `unsupported`
- Tambahkan error actionable untuk corrupt dan unsupported schema.
- Tambahkan stale detection dengan membandingkan fingerprint source saat ini.
- Reuse snapshot ketika fingerprint project tidak berubah.

### Verifikasi

Automated test memeriksa:

- snapshot dapat disimpan dan dibaca kembali;
- fingerprint stabil jika source tidak berubah;
- fingerprint berubah setelah source berubah;
- corrupt JSON terdeteksi;
- unsupported schema terdeteksi;
- project unchanged menggunakan snapshot lama.

### Pelajaran

Snapshot adalah kontrak publik antarbagian DevMap. File tersebut harus
divalidasi seperti input eksternal, bukan hanya di-cast ke interface.

---

## 6. Peringatan Snapshot Stale Muncul Saat Verifikasi Paralel

**Tanggal:** 2026-06-10

### Gejala

Saat `analyze` dan `ask` dijalankan bersamaan dalam proses verifikasi, `ask`
menampilkan:

```text
The project has changed since this snapshot was generated.
```

### Akar Masalah

`analyze` sedang menulis snapshot baru ketika `ask` membaca snapshot dan
menghitung fingerprint. Kedua command tersebut dijalankan paralel oleh proses
verifikasi, bukan oleh alur pengguna normal.

### Solusi

- Jalankan manual verification `analyze` lalu `ask` secara berurutan.
- Jangan memakai hasil race tersebut sebagai bukti bug stale detection.

### Verifikasi

Urutan berikut tidak menampilkan warning stale:

```powershell
node packages\cli\dist\index.js analyze
node packages\cli\dist\index.js ask "where is snapshot validation handled"
```

### Pelajaran

Test yang aman diparalelkan belum tentu aman untuk command yang membaca dan
menulis artifact project yang sama.

---

## 7. Tarball npm Memasukkan File yang Tidak Seharusnya

**Tanggal ditemukan:** 2026-06-10

**Status:** Selesai.

### Gejala

Dry-run package:

```powershell
pnpm --filter devmap pack --dry-run
```

menunjukkan tarball ikut membawa:

- `.devmap/snapshot.json`
- folder `src/`
- folder `test/`
- test fixture
- fixture `.env`
- fixture `node_modules`

### Akar Masalah

Package CLI belum memiliki allowlist `files` atau `.npmignore` yang ketat.

### Solusi

Gunakan allowlist pada `packages/cli/package.json`, misalnya:

```json
{
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ]
}
```

Tambahkan script `prepack` untuk memastikan build selalu dibuat sebelum tarball.

Pastikan fixture `.env`, test, source development, dan snapshot lokal tidak
masuk package.

### Verifikasi

```powershell
pnpm --filter devmap pack --pack-destination artifacts
npm exec --yes --package .\artifacts\devmap-0.1.0.tgz -- devmap --version
npm exec --yes --package .\artifacts\devmap-0.1.0.tgz -- devmap --help
```

Tarball hanya berisi `dist`, `package.json`, `README.md`, dan `LICENSE`.
Command versi dan help berhasil langsung dari tarball.

### Pelajaran

`.gitignore` tidak cukup untuk mengontrol isi package npm. Selalu periksa hasil
`pack --dry-run` sebelum publish.

---

## 8. Context Builder Harus Membatasi Akses File

**Tanggal:** 2026-06-11

### Risiko

Context Builder membaca path yang berasal dari snapshot. Snapshot dapat diedit
manual dan berisi path seperti:

```text
../outside-secret.ts
```

Tanpa validasi, DevMap berisiko membaca file di luar project root dan
mengirimkannya ke AI.

### Solusi

- Resolve project root menggunakan `realpath()`.
- Resolve candidate file.
- Hitung `relative(root, candidate)`.
- Tolak absolute path dan path yang dimulai dengan `..`.
- Resolve real path candidate untuk mencegah escape melalui symlink.
- Ulangi boundary check setelah symlink di-resolve.

### Verifikasi

Automated test menambahkan path berbahaya ke `snapshot.fileIndex`, kemudian
memastikan:

- file tersebut tidak dipilih;
- isi file di luar root tidak terbaca;
- batas maksimal file tetap diterapkan.

### Pelajaran

Snapshot harus dianggap sebagai input yang tidak sepenuhnya terpercaya.
Keamanan path wajib diperiksa sebelum membaca source file.

---

## 9. Default Model Groq di PRD Sudah Tidak Tersedia

**Tanggal:** 2026-06-11

### Gejala

PRD menetapkan model berikut sebagai default:

```text
qwen-2.5-coder-32b
```

Model tersebut tidak lagi tercantum pada daftar model aktif Groq.

### Akar Masalah

Ketersediaan model AI provider berubah dari waktu ke waktu. Model routing di PRD
dibuat berdasarkan katalog lama dan belum diverifikasi ulang sebelum integrasi
completion client.

Groq saat ini menyediakan:

- `openai/gpt-oss-20b` sebagai production model;
- `llama-3.3-70b-versatile` sebagai production model;
- `qwen/qwen3-32b` sebagai preview model.

Preview model tidak aman dijadikan default public release karena dapat dihentikan
dengan pemberitahuan singkat.

### Solusi

- Gunakan `openai/gpt-oss-20b` untuk standard `analyze`.
- Gunakan `llama-3.3-70b-versatile` untuk `analyze --deep`.
- Gunakan `llama-3.3-70b-versatile` sebagai fallback.
- Perbarui PRD dan architecture docs.
- Tambahkan model fallback pada Groq client.
- Hormati custom model dari config jika user tidak memakai nilai `auto`.

### Verifikasi

- Model diverifikasi melalui dokumentasi resmi Groq pada 2026-06-11.
- Automated test memastikan fallback dipakai ketika primary model menerima
  response model unavailable.
- Automated test memastikan config `auto` memakai default model terbaru.

### Pelajaran

Model ID provider bukan konstanta permanen. Verifikasi production model list
sebelum release dan jangan menjadikan preview model sebagai default.

---

## 10. Smoke Test npx Paralel Membaca Instalasi yang Belum Selesai

**Tanggal:** 2026-06-11

**Status:** Selesai.

### Gejala

`devmap --version` berhasil, tetapi `devmap --help` sempat gagal dengan:

```text
ENOENT: no such file or directory, open '...\node_modules\devmap\dist\commands\init.js'
```

### Akar Masalah

Dua command `npx` dijalankan paralel dan memakai cache `_npx` yang sama.
Salah satu proses mulai menjalankan binary ketika proses lain masih menyiapkan
isi package. Tarball dan instalasi akhirnya sama-sama memiliki `init.js`.

### Solusi

- Jalankan smoke test package secara berurutan.
- Gunakan cache npm terpisah untuk setiap instalasi ketika perlu isolasi penuh.
- Jangan menyimpulkan file tarball hilang sebelum memeriksa isi arsip dengan
  `tar -tf`.

### Verifikasi

```powershell
npm exec --yes --cache "$env:TEMP\devmap-version" --package $tarball -- devmap --version
npm exec --yes --cache "$env:TEMP\devmap-help" --package $tarball -- devmap --help
```

Keduanya berhasil.

### Pelajaran

Package installation bukan operasi yang aman diparalelkan ketika proses berbagi
cache yang sama. Smoke test distribusi harus deterministik dan berurutan.

---

## 11. Pertanyaan NextAuth Jatuh ke Fallback Critical File

**Tanggal:** 2026-06-11

**Status:** Selesai.

### Gejala

Pada benchmark Context Builder, pertanyaan:

```text
Explain the NextAuth configuration
```

menempatkan `app/api/session/route.ts` di posisi pertama, bukan `lib/auth.ts`.
File yang benar masih masuk top-3, tetapi top-1 accuracy hanya 19/20.

### Akar Masalah

Keyword tokenizer menghasilkan `nextauth`, sedangkan concept alias auth hanya
memiliki `auth` dan tidak memiliki bentuk nama provider tersebut. Karena tidak
ada direct match, ranking jatuh ke fallback critical file.

### Solusi

Tambahkan `nextauth` ke concept alias authentication.

### Verifikasi

```powershell
pnpm --filter devmap exec tsx --test test/context-builder-eval.test.ts
```

Hasil:

```text
Context Builder top-1 accuracy: 20/20
Context Builder top-3 recall: 20/20
```

### Pelajaran

Concept alias perlu mencakup nama provider populer, bukan hanya nama concern
generik. Eval bilingual membantu menemukan gap yang tidak terlihat dari unit
test satu pertanyaan.

---

## 12. Jawaban AI Menampilkan Markdown Mentah di Terminal

**Tanggal:** 2026-06-12

**Status:** Selesai.

### Gejala

Output `devmap ask` (sebelum dihapus) menampilkan marker seperti `**bold**`, backtick, dan table
pipe secara literal. Tabel lebar terpotong oleh terminal dan sulit dipindai.

### Akar Masalah

Konten AI langsung dikirim ke `output.codeBlock()`. Helper tersebut cocok untuk
source preview, tetapi tidak memahami struktur Markdown yang dihasilkan model.

### Solusi

- Tambahkan pure utility `renderTerminalMarkdown()`.
- Render heading, prose, list, fenced code, dan inline formatting.
- Ubah Markdown table menjadi record vertikal.
- Bungkus text berdasarkan lebar terminal.
- Gunakan renderer hanya untuk jawaban AI `analyze`.
- Pertahankan `codeBlock()` untuk static source context.

### Verifikasi

- Unit test mencakup heading, inline marker, list, table, wrapping, dan code
  fence.
- Integration test memastikan output `analyze` tidak
  menampilkan marker Markdown mentah.
- Preview manual dengan contoh database menghasilkan blok `users` dan `rooms`
  yang terbaca tanpa table pipe.

### Pelajaran

AI response dan source preview adalah dua jenis output berbeda. AI response
memerlukan semantic rendering, sedangkan source code harus dipertahankan
literal.

---

## Checklist Saat Menambahkan Debug Baru

Tambahkan catatan baru ketika:

- error membutuhkan investigasi lebih dari sekadar typo;
- masalah hanya muncul pada OS atau versi Node tertentu;
- penyebab berbeda dari gejala awal;
- solusi mengubah arsitektur, konfigurasi, atau workflow;
- masalah berpotensi muncul kembali saat release.

Gunakan format:

```md
## Judul Masalah

**Tanggal:** YYYY-MM-DD
**Status:** Selesai / Belum selesai

### Gejala
### Akar Masalah
### Solusi
### Verifikasi
### Pelajaran
```
## 12. Packed E2E Mengasumsikan Layout Internal npm

**Tanggal:** 2026-06-13
**Status:** Selesai

### Gejala

Package smoke test gagal pada GitHub Actions Ubuntu dengan `MODULE_NOT_FOUND`
untuk path `node_modules/npm/bin/npm-cli.js`.

### Akar Masalah

Harness menyusun path internal npm relatif terhadap `process.execPath`.
Layout tersebut tersedia pada instalasi Node lokal tertentu, tetapi bukan
kontrak lintas platform dan tidak dipakai oleh image Node GitHub Actions.

### Solusi

Jalankan executable npm resmi yang berada di samping binary Node:

- `npm.cmd` pada Windows;
- `npm` pada Linux dan macOS.

Windows menjalankan `npm.cmd` melalui shell, sedangkan Node, pnpm, dan binary
Linux/macOS tetap dijalankan langsung. pnpm tetap memakai `npm_execpath` yang
disediakan oleh pnpm.

### Verifikasi

- `pnpm test:package-e2e`
- package smoke test GitHub Actions

### Pelajaran

Jangan bergantung pada struktur internal instalasi package manager. Gunakan
executable publiknya ketika menguji perilaku CLI lintas platform.

## 13. Persisted Data Dipercaya Tanpa Validasi Mendalam

**Tanggal:** 2026-06-14
**Status:** Selesai

### Gejala

Config dengan schema salah tetap dianggap valid, dan snapshot dengan entry
`fileIndex` tidak lengkap dapat membuat Context Builder melempar `TypeError`.
Groq client juga berhenti setelah satu retry ketika beberapa respons 429 muncul
berturut-turut.

### Akar Masalah

Validasi hanya dilakukan pada JSON dan field snapshot tingkat atas. Data lokal
yang dapat rusak atau berasal dari versi lama langsung di-cast ke type
TypeScript. Retry rate limit memakai satu cabang `if`, bukan loop berbatas.

### Solusi

- Validasi provider dan model config sebelum mengembalikan config.
- Validasi shape setiap entry `fileIndex` sebelum snapshot dianggap valid.
- Retry HTTP 429 maksimal tiga kali dengan backoff 1x, 2x, dan 4x.

### Verifikasi

- Automated tests untuk config invalid dan entry `fileIndex` invalid.
- Automated tests untuk recovery setelah tiga 429 dan error setelah retry habis.
- `pnpm test:cli`
- `pnpm test:package-e2e`

### Pelajaran

TypeScript type assertion tidak memvalidasi data runtime. Semua data persisted
harus melewati boundary validation sebelum dipakai oleh command lain.

## 14. Ask Output Terlalu Ramai Dan Jawaban Berulang (removed)

**Tanggal:** 2026-06-16
**Status:** Selesai

### Gejala

Output `devmap ask` (sebelum dihapus) menampilkan `Relevant Files` dengan alasan scoring yang panjang
dan jawaban AI dapat mengulang kalimat, memberi high-level outline terlalu
panjang, atau menampilkan contoh kode padahal user hanya butuh arah file.

### Akar Masalah

Output human-readable memakai detail ranking internal yang lebih cocok untuk
machine/debug output. Keyword extraction juga masih menyimpan connector word
English seperti `to` dan `in`, sehingga partial match dapat menaikkan file yang
tidak relevan. Prompt `ask` belum memberi kontrak format yang cukup tegas.

### Solusi

- Human output `Relevant Files` hanya menampilkan path.
- Alasan scoring tetap dipertahankan pada `ask --json`.
- Connector word English umum dikeluarkan dari keyword ranking.
- Action word English dipisahkan menjadi intent generik, bukan hardcoded ke
  satu topik atau satu file.
- Path/export scoring lebih memprioritaskan exact search terms daripada
  substring match.
- Retrieval menambahkan confidence dan minimum relevance threshold. Jika tidak
  ada file yang melewati threshold, `ask` berhenti dengan jawaban lokal
  low-confidence tanpa memanggil Groq.
- Context file menyiapkan field `exports`, `topFunctions`, dan `purpose` untuk
  function-level navigation berikutnya tanpa mengubah scope extraction sekarang.
- Prompt `ask` meminta direct answer, `Key Files`, `Evidence` jika perlu,
  `Limits` jika context kurang, dan melarang repetisi serta code example panjang
  kecuali diminta. Untuk pertanyaan implementasi, prompt mengarahkan jawaban ke
  file/fungsi existing dalam context sebelum menyarankan file baru.

### Verifikasi

- `pnpm --filter devmap exec tsx --test test/context-builder.test.ts test/ai-client.test.ts`

### Pelajaran

Informasi ranking bagus untuk agent dan debugging, tetapi terlalu bising untuk
terminal manusia. Human mode harus ringkas; machine detail harus berada di JSON.
Untuk MVP, `ask` adalah navigation helper berbasis snapshot, bukan coding
agent. Low-confidence harus hemat token dan jujur, bukan meminta AI menebak.

## 15. Ask Retrieval Butuh Recall Tanpa Mengorbankan Precision

**Tanggal:** 2026-06-17
**Status:** Selesai

### Gejala

Keyword-only retrieval terlalu kaku untuk istilah developer yang berbeda-beda,
tetapi menambah alias hardcoded per teknologi berisiko membuat DevMap menjadi
kumpulan special-case React/Auth/OAuth.

### Akar Masalah

Context Builder perlu membedakan kata asli user, inferred retrieval hint, dan
confidence ranking. Tanpa pemisahan itu, expanded concept dapat mengalahkan
direct match atau membuat file lemah terlihat seolah relevan.

### Solusi

- Tambahkan query expansion Groq ringan yang hanya menghasilkan JSON array
  retrieval terms.
- Simpan `expandedTerms` di `QuestionContext`.
- Beri bobot expanded terms lebih rendah dari keyword langsung.
- Gunakan confidence 70/40 dan threshold 25 sebelum membaca context file.
- Jika confidence `low`, hentikan sebelum answer model dan tampilkan jawaban
  lokal yang transparan.
- Jika expansion gagal atau JSON invalid, fallback ke keyword-only behavior.

### Verifikasi

- Expanded terms ikut ranking.
- Direct keyword match mengalahkan expanded-term match.
- File di bawah threshold dikeluarkan.
- Invalid expansion JSON fallback aman.
- Focused suite:

```powershell
pnpm --filter devmap exec tsx --test test/context-builder.test.ts test/ai-client.test.ts
```

### Pelajaran

LLM boleh membantu recall, tetapi deterministic scorer tetap harus memegang
kendali ranking. Untuk MVP, Ask harus menjadi navigator yang jujur: kalau bukti
lemah, lebih baik mengaku tidak menemukan strong match daripada menyusun
jawaban yang terdengar yakin.

## 16. Snapshot Perlu Purpose Tanpa Membuat Analyze Lambat

**Tanggal:** 2026-06-17
**Status:** Selesai

### Gejala

Snapshot lama menyimpan path, imports, exports, dan line count, tetapi belum
menjelaskan file dipakai untuk apa. Akibatnya Ask dan calon onboarding/flow
harus menebak purpose dari nama file atau membaca source context lagi.

### Akar Masalah

`fileIndex` belum memiliki metadata navigasi seperti purpose, responsibility
scope, feature ownership, search terms, dan importance. Jika purpose dibuat
dengan AI per file, analyze akan lambat dan boros.

### Solusi

- Tambahkan metadata Tier 1 di `fileIndex`.
- Isi `scope`, `featureRefs`, `searchTerms`, dan `importance` secara statis.
- Beri fallback purpose deterministik untuk file penting.
- Tambahkan AI enrichment batched maksimal 20 file per call untuk memperbaiki
  purpose/searchTerms saat API key tersedia.
- Jika AI enrichment gagal, analyze tetap menyimpan snapshot valid.
- Tambahkan `flows` minimal hanya untuk high-confidence features.

### Verifikasi

- `test/analyzers.test.ts` mengecek field snapshot Tier 1.
- `test/analyze-ai.test.ts` mengecek batch AI dan failure fallback.
- `test/context-builder.test.ts` mengecek searchTerms/feature metadata ikut
  retrieval.

### Pelajaran

Snapshot kuat bukan berarti menyimpan source lebih banyak. Yang paling berguna
adalah metadata kecil yang menjelaskan tujuan file dan hubungan antar bagian,
supaya AI agent dapat bergerak lebih cepat tanpa eksplorasi ulang.

## 17. Astro Latest Tidak Kompatibel Dengan Target Node 18

**Tanggal:** 2026-06-18
**Status:** Selesai

### Gejala

Saat migrasi landing page dari Vue ke Astro, `pnpm install` dengan dependency
`astro@latest` mengambil `astro@6.4.8`. Lockfile menunjukkan engine:

```text
node >=22.12.0
```

Ini bertentangan dengan requirement DevMap yang masih mendukung Node.js 18+.

### Akar Masalah

Specifier `latest` mengikuti rilis Astro terbaru, bukan versi mayor yang cocok
dengan target runtime repository. Framework frontend dapat menaikkan requirement
Node pada major release baru.

### Solusi

- Pin Astro ke `5.7.14`.
- Verifikasi lockfile menunjukkan engine:

```text
node ^18.17.1 || ^20.3.0 || >=22.0.0
```

- Pertahankan `@astrojs/check` untuk menjalankan `astro check` sebelum build.

### Verifikasi

```powershell
pnpm install
pnpm build:web
```

`astro check` menghasilkan 0 diagnostics dan `astro build` berhasil membuat
static route `/index.html`.

### Pelajaran

Jangan memakai `latest` untuk dependency framework pada repo yang memiliki
target Node eksplisit. Cek engine package yang ter-resolve di lockfile sebelum
menganggap build lokal cukup aman untuk CI.

## 18. Agent Skills Terdeteksi Sebagai Fitur AI Project

**Tanggal:** 2026-06-18
**Status:** Selesai

### Gejala

Snapshot DevMap mendeteksi `.agents/skills` sebagai bagian project dan
menganggap skill development agent sebagai sistem AI terintegrasi. Padahal
folder tersebut hanya dipakai untuk instruksi agent saat mengembangkan DevMap.

### Akar Masalah

Scanner belum mengabaikan folder metadata agent development. Akibatnya file
seperti `.agents/skills/*/SKILL.md` ikut terbaca oleh analyzer fitur dan service.

### Solusi

- Tambahkan `.agent` dan `.agents` ke ignore directory scanner.
- Tambahkan test scanner untuk memastikan `.agents/skills` tidak masuk hasil
  scan.

### Verifikasi

```powershell
pnpm --filter devmap exec tsx --test test/analyzers.test.ts
```

### Pelajaran

Folder dotfile yang dipakai alat development dapat berisi kata kunci AI, auth,
atau service. Scanner harus membedakan metadata development dari source project
agar snapshot tetap merepresentasikan aplikasi yang dianalisis.

## 19. Authentication Palsu Dari Prompt Dan Dokumentasi Source

**Tanggal:** 2026-06-20
**Status:** Selesai

### Gejala

Setelah role filtering pertama, snapshot DevMap sendiri masih mendeteksi
Authentication dari `contextBuilder.ts`, `snapshotEnrichment.ts`, onboarding,
dan generated instructions. File tersebut hanya menyebut contoh auth di string.

### Akar Masalah

Fallback semantic auth role membaca seluruh content dan menganggap kombinasi
kata `auth`, `session`, `middleware`, atau `guard` sebagai runtime behavior.
Prompt dan dokumentasi embedded memenuhi pola itu tanpa implementasi auth.

### Solusi

- Technical features tidak memakai documentation, landing UI, atau test files.
- Auth consumer membutuhkan bukti path, import, atau symbol.
- Guard membutuhkan bukti auth dan guard pada path/symbol/import, bukan content
  bebas.
- Provider membutuhkan auth import atau symbol yang kuat.
- Regression fixture memasukkan prompt-like strings agar bug tidak kembali.

### Verifikasi

Focused analyzer tests lulus dan fresh analysis pada root DevMap menghasilkan
AI Integration, Analysis Engine, CLI Commands, Documentation, Snapshot Engine,
serta Web Landing tanpa Authentication.

### Pelajaran

Kata teknis di prompt, docs, dan detector source bukan bukti capability runtime.
Feature attribution harus bertumpu pada struktur kode dan ownership file.


## 20. File Non-Native (.vue .svelte .astro) Tidak Ter-analyze Dengan Benar

**Tanggal:** 2026-06-26
**Status:** Selesai

### Gejala

File `.vue`, `.svelte`, dan `.astro` masuk `HeuristicAnalyzer` yang hanya
pakai regex. Akibatnya import dan symbol dari `<script>` block tidak
terdeteksi dengan akurat. Confidence selalu `"medium"` padahal file ini
adalah source code penuh yang bisa di-parse AST.

### Akar Masalah

ts-morph adalah pure TypeScript/JavaScript parser — dia tidak mengerti
format SFC (Single File Component) yang mencampur template, style, dan
script dalam satu file. Tidak ada preprocessing step yang memisahkan
script block sebelum dilempar ke ts-morph.

### Solusi

Buat layer `preprocessors/` sebelum ts-morph:

```
ScannedFile (.vue/.svelte/.astro)
  → preprocessor.extract()     ekstrak pure JS/TS dari script block
  → ExtractedScript             pure code + language + lineOffset
  → ts-morph parse              semantic analysis seperti .ts biasa
  → FileAnalysis (confidence: "high")
```

Setiap format punya preprocessor sendiri:
- `VuePreprocessor` — regex match `<script>` dengan optional `lang="ts"`
- `SveltePreprocessor` — prefer instance script, fallback ke module script
- `AstroPreprocessor` — match frontmatter antara `---` fences

File tanpa script block (template-only component) return `null` dari
`extract()` — `TsMorphAnalyzer` handle ini dengan empty medium-confidence
analysis daripada crash.

`HeuristicAnalyzer.supports()` dihapus dari ketiga extension ini agar
boundary antar analyzer eksplisit. Sebelumnya ada overlap yang membuat
fallback implicit dan sulit di-debug.

### Verifikasi

Analyze project Vue/Nuxt atau Astro — file `.vue` dan `.astro` sekarang
punya `analyzer: "ts-morph"` dan `analysisConfidence: "high"` di
`fileIndex`.

### Pelajaran

File yang punya embedded JS/TS butuh preprocessing sebelum masuk AST
parser. Interface `LanguagePreprocessor` memisahkan extraction concern dari
parsing concern — tambah format baru tidak perlu ubah ts-morph logic.

---

## 21. Feature Detection Hardcode ke Domain DevMap Sendiri

**Tanggal:** 2026-06-26
**Status:** Selesai

### Gejala

Hasil `devmap analyze` pada project lain (DevNote, toko online, dll) hanya
menampilkan:

```
Authentication ✅
Database ✅
Documentation ✅
Sisanya noise atau kosong ❌
```

Feature seperti "Snippet Management", "Workspace", "Order Management" tidak
muncul. Sementara di project DevMap sendiri ada "Snapshot Engine" dan
"Analysis Engine" yang tidak relevan untuk project lain.

### Akar Masalah

`featureDetector.ts` punya dua masalah utama:

1. `ROLE_FEATURES` mengandung `"snapshot-engine"` dan `"analysis-engine"`
   yang hanya match di folder `/src/analyzers/` dan `/src/cache/` — path
   spesifik DevMap. Project lain selalu evidence kosong.

2. `FEATURE_FILE_PRIORITIES` berisi regex path DevMap seperti:
   `/\/analyzers\/tsmorphanalyzer\.[cm]?[jt]s$/` — sorting jadi arbitrary
   untuk project lain karena semua pattern miss.

3. Tidak ada mekanisme untuk detect domain features seperti "Snippet
   Management" atau "Workspace" yang bergantung pada apa yang project
   *lakukan*, bukan library apa yang dipakai.

### Solusi

Redesign feature detection menjadi pipeline berlayer:

```
Layer 1 — Technical Features (library-based, tetap ada)
  FEATURE_SIGNALS: diperluas dari 6 ke 15 signals
  matchesSignal: whole-word fix untuk term pendek

Layer 2 — Entity Extraction (schema-based)
  PrismaExtractor: parse schema.prisma → entity names + relations
  RouteFallbackExtractor: derive entity hints dari URL segments

Layer 3 — Capability Detection (route-based)
  CRUD: group routes by resource + HTTP methods
  Behavioral: sharing, collaboration, discovery, social, dll

Layer 4 — Feature Assembly (consume Layer 1-3)
  capabilitiesToFeatures(): CRUD capability → "Snippet Management"
  entityGraphToFeatures(): Prisma entity → feature dengan relation context

Layer 5 — AI Domain Inference (optional, structured metadata)
  Input: entities + capabilities + technical features (bukan raw code)
  Output: domain name + domain-specific features
  Token: ~300-500 per call
```

Keputusan utama: **tidak** implement route-segment-to-feature-name mapping
(`/snippets` → "Snippet Management") karena approach ini sama hardcode-nya
dengan yang sebelumnya — cuma pindah layer. Entity extraction + capability
detection lebih scalable karena tidak perlu tau nama domain upfront.

`fileRole.ts` di-generalize: hapus `"snapshot-engine"` dan
`"analysis-engine"`, tambah 6 generic architectural roles.

### Verifikasi

Analyze DevNote menghasilkan:
```
Snippet Management    ✅ dari CRUD capability /api/snippets
Content Sharing       ✅ dari behavioral signal /snippets/[id]/share
Team Collaboration    ✅ dari /workspaces/[id]/members + /join
Social Interactions   ✅ dari /snippets/[id]/like + /favorite
API Layer             ✅ dari fileRole "api-handler"
Service Layer         ✅ dari fileRole "service"
AI Integration        ❌ false positive dihilangkan (lihat #22)
```

### Pelajaran

Feature detector yang bagus harus bisa jawab: "apa yang project ini
*lakukan*?" bukan hanya "library apa yang dipakai?". Entity dan route
adalah dua sumber informasi yang paling reliable karena keduanya adalah
kontrak eksplisit project — bukan inferred dari naming.

Domain-specific features (Syntax Highlighting, Certificate Generation, dll)
memang tidak bisa di-detect secara static karena terlalu domain-specific.
Itu territory AI inference — dan AI inference harus terima structured
metadata, bukan raw source code.

---

## 22. "ai" Substring Match False Positive di Feature Detection

**Tanggal:** 2026-06-26
**Status:** Selesai

### Gejala

DevNote ke-detect punya "AI Integration" dengan evidence:
- `apps/web/src/components/snippet/shared/SnippetDetail.tsx`
- `apps/web/tailwind.config.ts`
- `apps/web/src/components/snippet/SnippetList.tsx`

DevNote tidak memakai AI library apapun.

### Akar Masalah

`matchesSignal()` pakai `path.includes(term)` untuk semua terms termasuk
term pendek `"ai"`. Substring match menemukan:

```
"tailwind"    → "t-AI-lwind"  → match!
"detail"      → "det-AI-l"   → match!
"SnippetList" → tidak match   → tapi file lain match
```

Karena confidence dihitung dari jumlah evidence, banyak false positive
membuat confidence "high".

### Solusi

Term ≤3 karakter harus match sebagai whole word, bukan substring:

```typescript
function matchesPathTerm(path: string, term: string): boolean {
  if (term.length <= 3) {
    return new RegExp(`(?:^|[/._-])${escapeRegex(term)}(?:[/._-]|$)`).test(path)
  }
  return path.includes(term)
}
```

Test:
```
"tailwind.config.ts" + "ai" → ❌ (ai di tengah kata, tidak ada separator)
"src/ai/provider.ts" + "ai" → ✅ (ai sebagai path segment, dikelilingi /)
"lib/ai.ts" + "ai"          → ✅ (ai diikuti .)
"SnippetDetail.tsx" + "ai"  → ❌ (ai di tengah kata)
```

Terms yang kena fix: `"ai"`, `"cms"`, `"db"`, `"i18n"`, `"l10n"`.
Long terms seperti `"stripe"`, `"openai"`, `"redis"` tetap substring match.

### Verifikasi

Analyze DevNote — "AI Integration" tidak muncul lagi di features.

### Pelajaran

Term pendek dalam feature detection selalu berisiko substring false positive.
Semua term ≤3 karakter harus pakai whole-word matching di path check.
Import matching tetap aman pakai substring karena import specifiers adalah
package names yang well-defined.

---

## 23. routeDetector Miss Monorepo Prefix

**Tanggal:** 2026-06-26
**Status:** Selesai

### Gejala

`devmap analyze` pada DevNote (monorepo dengan path `apps/web/src/app/...`)
menghasilkan:

```
Routes
──────────────────
None detected yet
```

Padahal Entry Points sudah ke-detect dengan benar, termasuk:
```
apps/web/src/app/api/auth/[...nextauth]/route.ts
```

### Akar Masalah

Regex di `detectNextRoutes()` memakai `^` anchor:

```typescript
/^(?:src\/)?app\/(.+\/)?(page|route)\.[jt]sx?$/
```

Anchor `^` memaksa match dari awal string. Path `apps/web/src/app/...`
punya prefix `apps/web/` yang membuat anchor miss.

### Solusi

Ganti `^` dengan `(?:^|\/)` agar match di manapun dalam path:

```typescript
/(?:^|\/)(?:src\/)?app\/(.+\/)?(page|route)\.[jt]sx?$/
```

Fix yang sama diterapkan ke Pages Router pattern. `(?:^|\/)` artinya:
"match di awal string ATAU setelah slash" — works untuk single-package
dan monorepo.

### Verifikasi

Analyze DevNote menghasilkan 35 routes terdeteksi dengan benar:
```
/api/snippets → apps/web/src/app/api/snippets/route.ts
/workspaces/[id] → apps/web/src/app/(dashboard)/workspaces/[id]/page.tsx
...
```

### Pelajaran

Regex dengan `^` anchor assume path dimulai dari project root. Monorepo
dengan workspace packages (`apps/web/`, `packages/cli/`) melanggar asumsi
ini. Gunakan `(?:^|\/)` untuk pattern yang harus berlaku di semua level path.

---

## 24. Test `flow --json` Tidak Sengaja Memanggil AI Live

**Tanggal:** 2026-08-05
**Status:** Selesai

### Gejala

Test `flow-command.test.ts` yang seharusnya "tanpa AI" gagal di dua tempat:
note "AI flow narration is not configured" tidak muncul, dan `--json`
mengembalikan `narrated: true` padahal test mengharapkan `false`.

### Akar Masalah

Mesin development memiliki config global nyata di `~/.devmap/config.json`
dengan API key valid. Test yang memanggil `flowCommand` tanpa dependency
`loadConfig` jatuh ke `readConfig` asli, sehingga flow membaca key tersebut
dan menjalankan narration AI live (memakai quota + membuat output tidak
deterministik).

### Solusi

Semua test tanpa AI wajib inject dependency:
`flowCommand(target, options, { loadConfig: async () => null })`. Test
narration tetap inject fake `createAiClient` seperti pola `analyze-ai.test.ts`.

### Verifikasi

`pnpm --filter devmap exec tsx --test test/flow-command.test.ts` — 10/10 pass,
tidak ada request AI live yang tersisa.

### Pelajaran

Test command yang membaca config global harus selalu inject `loadConfig`.
Config nyata di `~/.devmap/config.json` adalah lingkungan luar yang tidak
boleh mengubah hasil test. Hal yang sama berlaku untuk `map`/command lain
yang membaca config.

---

## Checklist Saat Menambahkan Debug Baru

Tambahkan catatan baru ketika:

- error membutuhkan investigasi lebih dari sekadar typo;
- masalah hanya muncul pada OS atau versi Node tertentu;
- penyebab berbeda dari gejala awal;
- solusi mengubah arsitektur, konfigurasi, atau workflow;
- masalah berpotensi muncul kembali saat release.

Gunakan format:

```md
## Judul Masalah

**Tanggal:** YYYY-MM-DD
**Status:** Selesai / Belum selesai

### Gejala
### Akar Masalah
### Solusi
### Verifikasi
### Pelajaran
```
