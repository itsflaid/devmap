# Panduan Testing DevMap

Dokumen ini adalah panduan testing lokal untuk development DevMap.

Semua command dijalankan dari root repository:

```powershell
cd "path\to\devmap"
```

## Persiapan Awal

Pastikan Node.js dan pnpm tersedia:

```powershell
node --version
pnpm --version
```

Install dependency:

```powershell
pnpm install
```

Requirement project:

- Node.js 18+
- pnpm 10.34.2

Versi package manager dikunci pada root `package.json`:

```json
{
  "packageManager": "pnpm@10.34.2"
}
```

Untuk meniru environment CI:

```powershell
$env:CI="true"
npx pnpm@10.34.2 install --frozen-lockfile
```

## Testing Otomatis CLI

Jalankan seluruh automated test dan TypeScript check:

```powershell
pnpm test:cli
```

Command tersebut menjalankan:

```powershell
pnpm --filter @devmap/cli test:unit
pnpm --filter @devmap/cli test:types
```

Saat ini test mencakup:

- file scanner dan ignore rules
- deteksi Next.js dan Express
- dependency graph
- import TypeScript dengan suffix `.js`
- external service detection
- project map
- snapshot save/read
- generator `DEVMAP.md`
- perlindungan agar `DEVMAP.md` tidak tertimpa
- alur `devmap init`
- missing API key
- unsupported provider
- global error handler
- missing project path

Hasil minimum yang diharapkan:

```text
tests 29
pass 29
fail 0
```

## Test Runner Lintas OS

Test CLI tidak lagi memakai shell wildcard:

```text
tsx --test test/*.test.ts
```

Gunakan runner berikut:

```text
packages/cli/test/run-tests.ts
```

Script package:

```json
{
  "test:unit": "tsx test/run-tests.ts"
}
```

Runner membaca seluruh file `*.test.ts` melalui Node.js sehingga bekerja
konsisten pada Windows, Ubuntu, dan macOS.

## Verifikasi Node.js 18 dan 20 di Windows

Untuk mereproduksi runtime CI tanpa mengganti Node.js utama:

```powershell
npx -p node@18 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
npx -p node@20 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
```

Hasil minimum yang diharapkan untuk keduanya:

```text
tests 29
pass 29
fail 0
```

## Testing AI Client Tanpa API Call

Automated test AI memakai fake `fetch` dan mock `AiClient`, sehingga tidak
memerlukan Groq API key dan tidak menghabiskan token.

Coverage saat ini:

- normalisasi response dan token usage;
- retry `429` menggunakan header `retry-after`;
- fallback ketika primary model tidak tersedia;
- invalid API key menjadi error actionable;
- prompt hanya memakai selected context;
- `ask` memakai model default ketika config bernilai `auto`;
- provider failure jatuh ke static context.
- standard analyze menyimpan AI architecture interpretation;
- analyze kedua memakai cached interpretation tanpa request baru;
- analyze prompt tidak mengandung full raw source.

Jalankan:

```powershell
pnpm test:cli
```

## Testing AI Ask dengan Groq

Testing manual ini memakai API key dan dapat menggunakan quota Groq.

```powershell
pnpm build:cli
node packages\cli\dist\index.js init
node packages\cli\dist\index.js analyze
node packages\cli\dist\index.js ask "Bagaimana autentikasi bekerja?"
```

Pastikan:

- file relevan ditampilkan;
- jawaban memakai bahasa pertanyaan;
- jawaban menyebut path yang benar;
- model dan token usage ditampilkan;
- raw provider error dan stack trace tidak muncul.

## Testing AI Analyze dengan Groq

```powershell
pnpm build:cli
node packages\cli\dist\index.js analyze --fresh
node packages\cli\dist\index.js analyze
node packages\cli\dist\index.js analyze --deep --fresh
```

Pastikan:

- command pertama menghasilkan section `Architecture`;
- model dan total token ditampilkan;
- `.devmap/snapshot.json` memiliki object `ai`;
- command kedua menampilkan `Cached: yes`;
- command kedua tidak melakukan request AI baru;
- `--deep --fresh` memakai model deep analysis;
- static snapshot tetap tersimpan jika Groq gagal.

## GitHub Actions

Workflow:

```text
.github/workflows/ci.yml
```

Matrix:

- OS: Ubuntu, Windows, macOS
- Node.js: 18, 20, 22

Setiap job menjalankan:

```powershell
pnpm install --frozen-lockfile
pnpm test:cli
pnpm build:cli
node packages/cli/dist/index.js --version
pnpm build:web
```

Total job yang harus hijau:

```text
9
```

## Development CLI Tanpa Build

Untuk menguji source terbaru tanpa build:

```powershell
pnpm dev:cli
```

Menjalankan command tertentu:

```powershell
pnpm dev:cli -- --help
pnpm dev:cli -- doctor
pnpm dev:cli -- analyze
pnpm dev:cli -- analyze --deep
pnpm dev:cli -- ask "where is scanner logic"
```

Gunakan mode ini selama development karena perubahan di `src/` langsung dipakai.

## Testing Hasil Build CLI

Build TypeScript:

```powershell
pnpm build:cli
```

Kemudian jalankan hasil production dari `dist/`:

```powershell
node packages\cli\dist\index.js
node packages\cli\dist\index.js --help
node packages\cli\dist\index.js doctor
node packages\cli\dist\index.js analyze
node packages\cli\dist\index.js ask "how does the analyzer work?"
```

Jika menjalankan file dari `dist/`, lakukan build ulang setelah source berubah.

## Testing `devmap init`

`devmap init` memvalidasi API key langsung ke Groq. Testing ini memerlukan
internet dan API key yang valid.

### Mode Interaktif

```powershell
pnpm dev:cli -- init
```

Alur yang diharapkan:

1. Provider memakai Groq.
2. Masukkan Groq API key.
3. Key divalidasi.
4. Config disimpan ke `~/.devmap/config.json`.
5. Folder `.devmap/` dibuat.
6. `.devmap/` ditambahkan ke `.gitignore`.
7. `DEVMAP.md` dibuat jika belum ada.
8. Framework project ditampilkan.

Catatan: input API key saat ini belum disamarkan di terminal.

### Mode Environment Variable

Set API key hanya untuk terminal aktif:

```powershell
$env:GROQ_API_KEY="gsk_your_key"
pnpm dev:cli -- init
Remove-Item Env:GROQ_API_KEY
```

Jangan menulis API key asli ke repository, screenshot, issue, atau dokumentasi.

### Hasil Yang Perlu Dicek

```powershell
Test-Path "$HOME\.devmap\config.json"
Test-Path ".devmap"
Test-Path "DEVMAP.md"
Select-String -Path ".gitignore" -Pattern ".devmap/"
```

Jangan menampilkan isi `~/.devmap/config.json` saat merekam demo karena file
tersebut berisi API key.

## Testing `DEVMAP.md`

Setelah `devmap init` berhasil:

```powershell
Get-Content DEVMAP.md
```

Pastikan file berisi:

- framework yang terdeteksi
- lokasi `.devmap/snapshot.json`
- command `analyze`, `ask`, dan `doctor`
- panduan untuk AI agent
- peringatan agar API key tidak di-commit

DevMap tidak boleh menimpa `DEVMAP.md` yang sudah ada.

Untuk menguji perlindungan tersebut:

1. Tambahkan satu baris pribadi ke `DEVMAP.md`.
2. Jalankan `devmap init` lagi.
3. Pastikan baris pribadi masih ada.

## Testing Error Handler

### Project Path Tidak Ada

```powershell
pnpm dev:cli -- analyze "Z:\path-that-does-not-exist"
```

Hasil yang diharapkan:

- exit code gagal
- pesan project path tidak ditemukan
- tip untuk memeriksa path
- tidak ada raw stack trace

### API Key Tidak Tersedia

Pada shell non-interaktif atau automation:

```powershell
Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
node packages\cli\dist\index.js init
```

Hasil yang diharapkan:

- pesan API key diperlukan
- saran menjalankan terminal interaktif atau memakai `GROQ_API_KEY`
- tidak ada raw stack trace

### API Key Tidak Valid

```powershell
$env:GROQ_API_KEY="invalid-key"
pnpm dev:cli -- init
Remove-Item Env:GROQ_API_KEY
```

Hasil yang diharapkan:

- pesan Groq API key invalid
- link menuju Groq Console
- config valid sebelumnya tidak ditimpa

## Testing Analyzer Pada Fixture

Fixture adalah project mini untuk testing yang berada di:

```text
packages/cli/test/fixtures/
├── nextjs-project/
└── express-project/
```

Analisis fixture Next.js:

```powershell
pnpm dev:cli -- analyze packages/cli/test/fixtures/nextjs-project
```

Hasil penting:

- Framework: `nextjs`
- Entry points mencakup `app/page.tsx` dan `app/layout.tsx`
- External services mencakup NextAuth dan Prisma
- `.env` dan `node_modules` tidak ikut dianalisis

Analisis fixture Express:

```powershell
pnpm dev:cli -- analyze packages/cli/test/fixtures/express-project
```

Hasil penting:

- Framework: `express`
- Entry point mencakup `src/server.ts`
- External services mencakup Stripe

## Testing Landing Page

Jalankan development server:

```powershell
pnpm dev:web
```

Buka URL yang ditampilkan Vite, biasanya:

```text
http://localhost:5173
```

Build production:

```powershell
pnpm build:web
```

Preview hasil production:

```powershell
pnpm preview:web
```

## Checklist Sebelum Commit

Jalankan:

```powershell
pnpm test:cli
pnpm build:cli
pnpm build:web
git diff --check
git status --short
```

Checklist manual:

- Semua test lulus.
- CLI build berhasil.
- Web build berhasil.
- Tidak ada raw stack trace.
- Tidak ada API key di staged files.
- Tidak ada `.devmap/`, `dist/`, atau `node_modules/` yang ikut staged.
- `PROGRESS.md` sudah diperbarui jika ada milestone baru.

Periksa staged diff sebelum commit:

```powershell
git diff --cached --stat
git diff --cached
```

## Testing Setelah Install Global

Tahap ini digunakan saat distribution testing sudah dimulai:

```powershell
pnpm build:cli
cd packages\cli
npm link
devmap
devmap --help
devmap doctor
```

Untuk melepas link global:

```powershell
npm unlink -g @devmap/cli
```
