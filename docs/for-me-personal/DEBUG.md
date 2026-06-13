# Catatan Debugging DevMap

Terakhir diperbarui: 2026-06-13

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

- Gunakan `openai/gpt-oss-20b` untuk `ask` dan standard `analyze`.
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

Jawaban `devmap ask` menampilkan marker seperti `**bold**`, backtick, dan table
pipe secara literal. Tabel lebar terpotong oleh terminal dan sulit dipindai.

### Akar Masalah

Konten AI langsung dikirim ke `output.codeBlock()`. Helper tersebut cocok untuk
source preview, tetapi tidak memahami struktur Markdown yang dihasilkan model.

### Solusi

- Tambahkan pure utility `renderTerminalMarkdown()`.
- Render heading, prose, list, fenced code, dan inline formatting.
- Ubah Markdown table menjadi record vertikal.
- Bungkus text berdasarkan lebar terminal.
- Gunakan renderer hanya untuk jawaban AI `ask` dan interpretation `analyze`.
- Pertahankan `codeBlock()` untuk static source context.

### Verifikasi

- Unit test mencakup heading, inline marker, list, table, wrapping, dan code
  fence.
- Integration test memastikan output `ask` dan cached `analyze` tidak
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
