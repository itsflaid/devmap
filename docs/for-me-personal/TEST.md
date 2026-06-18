# Panduan Testing DevMap

Dokumen ini adalah panduan praktis untuk menguji DevMap selama development dan
sebelum release.

Ada beberapa versi DevMap yang dapat diuji:

| Jenis tes | Yang dijalankan | Kapan digunakan |
|---|---|---|
| Source langsung | `packages/cli/src/` melalui `tsx` | Melihat perubahan terbaru secepat mungkin |
| Automated test | Test unit dan integration | Memastikan perubahan tidak merusak behavior |
| Build lokal | `packages/cli/dist/` | Memastikan hasil compile production bekerja |
| Tarball external | Package `.tgz` di project lain | Meniru instalasi pengguna npm |
| npm exec | Tarball tanpa global install | Memastikan gaya penggunaan `npx` bekerja |
| npm link | CLI global sementara | Menguji command `devmap` dari folder mana pun |
| CI/runtime | OS dan versi Node berbeda | Verifikasi lintas platform sebelum release |

## Context Builder Ranking

Jalankan focused test ranking dan evaluation:

```powershell
pnpm --filter devmap exec tsx --test test/context-builder.test.ts test/context-builder-eval.test.ts
```

Untuk polish output `ask`, jalankan focused contract test:

```powershell
pnpm --filter devmap exec tsx --test test/context-builder.test.ts test/ask-command.test.ts test/ai-client.test.ts
```

Expected result:

- Pertanyaan produk tidak memilih `test/`, `tests/`, `__tests__/`, fixture,
  `*.test.*`, atau `*.spec.*`.
- Pertanyaan testing dalam English dapat memilih file tersebut.
- Pertanyaan navigasi English memilih maksimal dua file dan 60 baris per file.
- Istilah CLI dan web UI memprioritaskan package yang sesuai.
- Connector word English seperti `to` dan `in` tidak menjadi keyword ranking.
- Action word English seperti `add`, `change`, dan `where` dipakai sebagai
  intent, bukan keyword ranking.
- Query perubahan fitur yang berbeda topik tetap memilih file existing yang
  relevan berdasarkan path/export/import, bukan special-case satu framework.
- Query expansion menyimpan `expandedTerms`, ikut ranking dengan bobot lebih
  rendah dari keyword langsung, dan fallback aman jika respons JSON invalid.
- Direct keyword match harus tetap mengalahkan expanded-term match.
- `fileIndex.searchTerms` dan `feature.searchTerms` ikut ranking sebagai sinyal
  snapshot yang kuat.
- `featureRefs`, `scope`, `importance`, dan `purpose` ikut membantu retrieval
  tanpa menggantikan direct keyword match.
- Query tanpa match kuat mengembalikan `confidence: "low"`, `topScore: 0`,
  dan `relevantFiles: []`, bukan fallback ke critical file acak.
- Query low-confidence tidak memanggil model jawaban Groq. Jika config AI ada,
  query expansion kecil masih boleh berjalan sebelum confidence dihitung.
  Command memberi template lokal agar hemat token dan tidak mengarang file.
- Human-readable `Relevant Files` hanya menampilkan path; alasan scoring tetap
  dicek melalui output `--json`.
- Evaluation tetap top-1 accuracy 20/20 dan top-3 recall 20/20.

## Snapshot Tier 1 Enrichment

Focused automated test:

```powershell
pnpm --filter devmap exec tsx --test test/analyzers.test.ts test/analyze-ai.test.ts test/context-builder.test.ts
```

Expected result:

- `fileIndex` memiliki `scope`, `purpose`, `featureRefs`, `searchTerms`, dan
  `importance`.
- Feature memiliki `purpose`, `files`, `entryPoints`, `searchTerms`, dan
  `confidence`.
- `flows` hanya dibuat untuk high-confidence features.
- AI enrichment memakai batch maksimal 20 file per call, bukan satu call per
  file.
- Jika AI enrichment gagal, `analyze` tetap menyimpan snapshot valid.

Manual source-mode check:

```powershell
pnpm dev:cli ask "where scanner"
pnpm dev:cli ask "which tests cover the scanner?"
pnpm dev:cli ask "where is the web UI dashboard component?"
```

Periksa `Relevant Files` dan prompt token usage. Query pertama seharusnya
memprioritaskan production CLI source dan memakai context jauh lebih kecil
daripada default lama lima file dengan maksimal 200 baris per file.
Untuk pertanyaan implementasi, jawaban seharusnya langsung menyebut file yang
perlu diperiksa/diedit lebih dulu dan tidak menampilkan contoh kode panjang
kecuali diminta.
Jika confidence rendah, jawaban seharusnya mengatakan tidak ada strong match,
tidak menampilkan `Asking Groq`, dan tidak menyebut file random sebagai sumber
pasti.

## Model Routing And Override

Focused automated test:

```powershell
pnpm --filter devmap exec tsx --test test/config-command.test.ts test/analyze-ai.test.ts test/ask-command.test.ts
```

Expected automatic routing:

- `ask`: `llama-3.1-8b-instant`
- `analyze`: `openai/gpt-oss-20b`
- `analyze --deep`: `openai/gpt-oss-120b`
- fallback: `openai/gpt-oss-20b`

Manual override:

```powershell
pnpm dev:cli config model openai/gpt-oss-120b
pnpm dev:cli doctor
pnpm dev:cli config model auto
```

The first command should preserve the existing API key and provider. The last
command should restore automatic command-based routing.

## Agent JSON Output

Focused contract test:

```powershell
pnpm --filter devmap exec tsx --test test/json-output.test.ts
```

Manual source-mode checks:

```powershell
pnpm dev:cli analyze --json
pnpm dev:cli ask "where scanner" --json
pnpm dev:cli doctor --json
pnpm dev:cli config model auto --json
```

Pipe output into a JSON parser:

```powershell
pnpm dev:cli doctor --json | ConvertFrom-Json
```

Expected:

- parsing succeeds without stripping ANSI;
- stdout contains one JSON document;
- no section header, separator, bullet, or Markdown formatting appears;
- API keys are never included;
- packed package E2E verifies JSON output after tarball installation.

## AI Response Streaming

Focused automated test:

```powershell
pnpm --filter devmap exec tsx --test test/ai-client.test.ts test/ask-command.test.ts test/analyze-ai.test.ts test/json-output.test.ts
```

Coverage penting:

- SSE event tetap terbaca ketika JSON event terpecah pada network chunk;
- delta dikirim berurutan dan hasil lengkap dikembalikan provider;
- `ask` dan fresh AI interpretation `analyze` memakai streaming jika tersedia;
- hasil lengkap `analyze` tetap disimpan ke snapshot;
- `--json` memakai completion penuh dan tidak memanggil streaming.

Manual live check:

```powershell
$env:GROQ_API_KEY="gsk_your_key"
pnpm dev:cli -- analyze --fresh
pnpm dev:cli -- ask "explain the main architecture"
pnpm dev:cli -- ask "explain the main architecture" --json | ConvertFrom-Json
Remove-Item Env:GROQ_API_KEY
```

Expected:

- human output mulai tampil sebelum seluruh AI response selesai;
- Markdown tidak tampil mentah;
- model dan token usage tetap muncul setelah stream selesai;
- JSON baru dicetak setelah response lengkap dan dapat diparse langsung.

## Urutan Testing Yang Direkomendasikan

Untuk development harian:

1. Jalankan source langsung tanpa build.
2. Jalankan test yang berhubungan dengan perubahan.
3. Jalankan seluruh automated test.
4. Build CLI dan uji file `dist`.

Sebelum membuat PR:

1. Jalankan seluruh automated test.
2. Build CLI.
3. Build web.
4. Jalankan `git diff --check`.
5. Review staged diff.

Sebelum publish MVP:

1. Jalankan seluruh langkah sebelum PR.
2. Buat tarball.
3. Install tarball pada project lain.
4. Uji `init`, `analyze`, `ask`, dan `doctor`.
5. Uji `npm exec` tanpa global install.
6. Uji Groq live.
7. Pastikan seluruh GitHub Actions hijau.
8. Ikuti checklist version, package inspection, npm publish, dan post-publish
   verification di `docs/releasing.md`.

## Release Hardening 0.1.0

Focused metadata test:

```powershell
pnpm --filter devmap exec tsx --test test/package-distribution.test.ts
```

Inspect metadata before packing:

```powershell
node -p "require('./packages/cli/package.json').version"
node -p "require('./packages/cli/package.json').description"
```

Expected:

- version `0.1.0`;
- package name `devmap`;
- description matches the product positioning;
- keyword includes AI, codebase, developer tools, and static analysis;
- package README includes `GROQ_API_KEY`, `--json`, privacy, and beta scope;
- root `CHANGELOG.md` contains the `0.1.0` release.

## Persiapan Awal

Semua command development dijalankan dari root repository DevMap:

```powershell
cd "C:\path\to\devmap"
```

Pastikan requirement tersedia:

```powershell
node --version
pnpm --version
```

Requirement:

- Node.js 18 atau lebih baru;
- pnpm 10.34.2.

Install dependency:

```powershell
pnpm install
```

---

## 1. Tes Source Langsung Tanpa Build

Ini adalah cara tercepat untuk melihat perubahan terbaru di source DevMap.

Tidak perlu menjalankan `pnpm build:cli`. Command menggunakan `tsx` dan membaca
file dalam `packages/cli/src/` secara langsung.

### Menjalankan Package CLI Langsung

`pnpm dev:cli` menjalankan package `devmap` melalui `pnpm --filter devmap`.
Karena itu current working directory command menjadi `packages/cli`, bukan root
repository. Mode ini bagus untuk mengetes CLI package, tetapi snapshot akan
dibuat di `packages/cli/.devmap/snapshot.json`.

```powershell
pnpm dev:cli
pnpm dev:cli -- --help
pnpm dev:cli -- doctor
pnpm dev:cli -- analyze
pnpm dev:cli -- analyze --fresh
pnpm dev:cli -- ask "bagaimana analyzer bekerja?"
```

### Menjalankan DevMap Pada Root Repository DevMap

Gunakan mode ini saat ingin DevMap menganalisis repository DevMap dari root dan
membuat snapshot di `.devmap/snapshot.json`.

Jangan gunakan `pnpm exec tsx ...` dari root workspace, karena `tsx` adalah
dependency package CLI dan tidak selalu tersedia sebagai binary root workspace.
Pakai binary `tsx.cmd` milik `packages/cli` secara langsung:

```powershell
.\packages\cli\node_modules\.bin\tsx.cmd .\packages\cli\src\index.ts analyze --fresh
.\packages\cli\node_modules\.bin\tsx.cmd .\packages\cli\src\index.ts ask "where do I start to add framework detection?"
.\packages\cli\node_modules\.bin\tsx.cmd .\packages\cli\src\index.ts doctor
```

Expected:

- `.devmap/snapshot.json` muncul di root repository DevMap;
- bukan di `packages/cli/.devmap/snapshot.json`;
- Ask membaca snapshot root yang baru dibuat.

Gunakan mode ini setelah mengubah:

- command CLI;
- analyzer;
- Context Builder;
- AI prompt;
- output terminal;
- error handling.

Perubahan source langsung terlihat pada command berikutnya.

### Menjalankan Analyzer Pada Fixture

Fixture aman digunakan karena tidak mengubah project pribadi:

```powershell
pnpm dev:cli -- analyze packages/cli/test/fixtures/nextjs-project --fresh
pnpm dev:cli -- analyze packages/cli/test/fixtures/express-project --fresh
```

Hasil penting Next.js:

- framework `nextjs`;
- entry point `app/page.tsx` dan `app/layout.tsx`;
- NextAuth dan Prisma terdeteksi;
- `.env`, lockfile, dan `node_modules` tidak dipindai.

Hasil penting Express:

- framework `express`;
- entry point `src/server.ts`;
- route payment dan Stripe terdeteksi.

### Catatan Tentang `init`

`devmap init` membuat atau mengubah file pada current working directory.

Jika hanya ingin menguji output terbaru, jalankan `analyze`, `ask`, dan `doctor`
di repository DevMap. Untuk menguji `init` secara lengkap, lebih aman gunakan
project sementara atau project lain agar `.gitignore`, `DEVMAP.md`, dan
`.devmap/` tidak mengganggu repository DevMap.

---

## 2. Automated Test

Automated test memakai fake provider untuk AI sehingga tidak memakai quota
Groq.

Jalankan seluruh test dan TypeScript check:

```powershell
pnpm test:cli
```

Command tersebut menjalankan:

```powershell
pnpm --filter devmap test:unit
pnpm --filter devmap test:types
```

Hasil minimum saat ini:

```text
tests 49
pass 49
fail 0
```

### Menjalankan Test Tertentu

Analyzer dan snapshot:

```powershell
pnpm --filter devmap exec tsx --test test/analyzers.test.ts
```

Expected tambahan:

- `.agent/` dan `.agents/` tidak masuk hasil scan;
- `.agents/skills/*/SKILL.md` tidak terdeteksi sebagai fitur AI project;
- snapshot tetap hanya merepresentasikan source project yang dianalisis;
- `fileIndex[*].topFunctions` berisi fungsi atau symbol kode penting dengan
  line number, status export, dan status async;
- `flows` mencakup feature flow dan request/API flow dari route ke dependency
  lokalnya.

AI client:

```powershell
pnpm --filter devmap exec tsx --test test/ai-client.test.ts
```

Command `ask`:

```powershell
pnpm --filter devmap exec tsx --test test/ask-command.test.ts
```

AI analyze:

```powershell
pnpm --filter devmap exec tsx --test test/analyze-ai.test.ts
```

Doctor:

```powershell
pnpm --filter devmap exec tsx --test test/doctor.test.ts
```

Terminal Markdown:

```powershell
pnpm --filter devmap exec tsx --test test/markdown-terminal.test.ts
```

Context Builder benchmark:

```powershell
pnpm --filter devmap exec tsx --test test/context-builder-eval.test.ts
```

Target Context Builder:

```text
Context Builder top-1 accuracy: 20/20
Context Builder top-3 recall: 20/20
```

---

## 3. Tes Hasil Build Lokal

Mode ini menguji JavaScript production dalam `packages/cli/dist/`.

Build CLI:

```powershell
pnpm build:cli
```

Jalankan hasil build:

```powershell
node packages/cli/dist/index.js
node packages/cli/dist/index.js --version
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js analyze --fresh
node packages/cli/dist/index.js ask "bagaimana analyzer bekerja?"
```

Perbedaan dengan source mode:

- source mode membaca perubahan terbaru secara langsung;
- build mode membaca file lama dalam `dist`;
- setelah source berubah, jalankan `pnpm build:cli` lagi sebelum menguji `dist`.

Gunakan build mode untuk menemukan:

- import yang gagal setelah compile;
- file output yang hilang;
- perbedaan source dan production build;
- masalah entry binary.

---

## 4. Tes Tarball Pada Project Lain

Ini adalah tes distribusi paling realistis sebelum package dipublish ke npm.

Automated E2E untuk membuat tarball, memasangnya pada project Next.js dan
Express sementara, lalu menjalankan binary hasil install:

```powershell
pnpm test:package-e2e
```

Tes ini memakai home directory sementara agar config Groq pribadi tidak
terbaca dan tidak melakukan request AI live.

Status manual terakhir:

- install tarball pada project eksternal berhasil;
- validasi API key Groq berhasil;
- command AI live berhasil dijalankan;
- nilai API key tidak dicatat dalam repository.

### A. Buat Tarball Dari Repository DevMap

Dari root repository DevMap:

```powershell
pnpm --filter devmap pack --pack-destination artifacts
```

Tarball akan dibuat di:

```text
artifacts/devmap-0.1.0.tgz
```

Simpan path absolutnya:

```powershell
$tarball = (Resolve-Path ".\artifacts\devmap-0.1.0.tgz").Path
$tarball
```

Pastikan isi package hanya mencakup:

- `dist/`;
- `package.json`;
- `README.md`;
- `LICENSE`.

Tidak boleh ada:

- `src/`;
- `test/`;
- `.env`;
- `.devmap/`;
- `node_modules/`.

### B. Buka Project Yang Akan Diuji

Contoh:

```powershell
cd "C:\path\to\project-lain"
```

Pastikan terminal berada di root project:

```powershell
Get-Location
Get-ChildItem
```

Biasanya root project memiliki `package.json`.

### C. Install Tarball

```powershell
npm install --save-dev "$tarball"
```

Setelah install, jalankan DevMap melalui:

```powershell
npx devmap --version
npx devmap --help
```

### D. Integrasikan DevMap Ke Project

Untuk AI live, set API key hanya pada terminal aktif:

```powershell
$env:GROQ_API_KEY="gsk_your_key"
```

Jalankan:

```powershell
npx devmap init
npx devmap analyze --fresh
npx devmap ask "jelaskan struktur dan alur utama project ini"
npx devmap doctor
```

`init` seharusnya:

- memvalidasi Groq API key;
- menyimpan config global ke `~/.devmap/config.json`;
- membuat `.devmap/`;
- menambahkan `.devmap/` ke `.gitignore`;
- membuat `DEVMAP.md` jika belum ada;
- membuat `AGENTS.md` dasar jika belum ada;
- meminta konfirmasi sebelum append ke existing `AGENTS.md`;
- tidak menimpa `AGENTS.md` atau `DEVMAP.md` yang sudah ada.

`analyze` seharusnya:

- mendeteksi framework dan package manager;
- menampilkan entry point, route, feature, database, dan service;
- membuat `.devmap/snapshot.json`;
- menampilkan architecture interpretation jika AI dikonfigurasi;
- menampilkan model dan token usage.

`ask` seharusnya:

- memilih file yang relevan;
- menjawab sesuai bahasa pertanyaan;
- merender heading, list, table, dan inline code dengan rapi;
- menampilkan model dan token usage;
- tidak menampilkan raw stack trace.

`doctor` seharusnya:

- menampilkan status config, key, model, snapshot, framework, OS, dan Node;
- tidak pernah menampilkan API key asli.

Hapus API key dari terminal setelah testing:

```powershell
Remove-Item Env:GROQ_API_KEY
```

### E. Setelah Source DevMap Berubah

Tarball yang sudah terpasang pada project lain tidak otomatis ikut berubah.

Ulangi:

```powershell
cd "C:\path\to\devmap"
pnpm --filter devmap pack --pack-destination artifacts

cd "C:\path\to\project-lain"
npm install --save-dev "C:\path\to\devmap\artifacts\devmap-0.1.0.tgz"
```

Kemudian jalankan kembali:

```powershell
npx devmap analyze --fresh
npx devmap ask "pertanyaan pengujian"
```

### F. Cleanup Project Uji

Hapus package development:

```powershell
npm uninstall devmap
```

File berikut adalah artifact integrasi DevMap:

```text
.devmap/
DEVMAP.md
```

Hapus hanya jika project tersebut memang project uji dan file tidak memiliki
perubahan penting. Periksa juga entry `.devmap/` pada `.gitignore`.

---

## 5. Tes Dengan `npm exec` Tanpa Install Global

Tes ini memastikan gaya penggunaan seperti `npx devmap` bekerja.

Dari root DevMap:

```powershell
$tarball = (Resolve-Path ".\artifacts\devmap-0.1.0.tgz").Path
```

Jalankan secara berurutan:

```powershell
npm exec --yes --cache "$env:TEMP\devmap-version" --package $tarball -- devmap --version
npm exec --yes --cache "$env:TEMP\devmap-help" --package $tarball -- devmap --help
```

Gunakan cache berbeda untuk menghindari race pada instalasi package.

---

## 6. Tes Dengan `npm link`

Ini opsional. Gunakan jika ingin command `devmap` tersedia secara global dan
tetap mengarah ke repository lokal.

Setup:

```powershell
pnpm build:cli
cd packages/cli
npm link
```

Sekarang command dapat dijalankan dari project mana pun:

```powershell
devmap --version
devmap analyze --fresh
devmap ask "jelaskan project ini"
devmap doctor
```

Setiap source berubah, build ulang:

```powershell
cd "C:\path\to\devmap"
pnpm build:cli
```

Lepaskan global link setelah selesai:

```powershell
npm unlink -g devmap
```

---

## 7. Tes AI Live Dengan Groq

Automated test tidak memakai quota. Bagian ini memakai API key dan quota Groq.

Set API key:

```powershell
$env:GROQ_API_KEY="gsk_your_key"
```

Flow minimum:

```powershell
devmap init
devmap analyze --fresh
devmap analyze
devmap ask "Bagaimana autentikasi bekerja?"
devmap ask "Jelaskan struktur database dalam tabel"
devmap doctor
```

Pastikan:

- `init` menyatakan key valid;
- analyze pertama menampilkan architecture dan token usage;
- analyze kedua memakai cache dan menampilkan `Cached: yes`;
- jawaban mengikuti bahasa pertanyaan;
- table dan Markdown tampil rapi;
- file yang disebut memang relevan;
- raw provider error dan stack trace tidak muncul;
- `doctor` menyatakan key dan model valid.

Tes deep model:

```powershell
devmap analyze --deep --fresh
```

Hapus key:

```powershell
Remove-Item Env:GROQ_API_KEY
```

Jangan menaruh API key dalam repository, screenshot, issue, atau chat.

---

## 8. Testing Safe `AGENTS.md` Integration

Gunakan project sementara agar file pribadi tidak berubah.

### File Belum Ada

Pastikan project tidak memiliki `AGENTS.md`, lalu jalankan:

```powershell
devmap init
```

Expected:

- DevMap membuat `AGENTS.md`;
- file berisi `DevMap Context`;
- block mengarahkan agent membaca `DEVMAP.md`.

### Existing File Dan User Menyetujui

Buat file:

```powershell
Set-Content AGENTS.md "# Existing Instructions"
devmap init
```

Jawab:

```text
AGENTS.md exists. Append DevMap instructions? [y/N]: yes
```

Expected:

- isi lama tetap ada;
- DevMap block ditambahkan di bagian akhir;
- rerun `init` tidak menggandakan block.

### Existing File Dan User Menolak

Jalankan `init`, lalu jawab `n` atau tekan Enter.

Expected:

- existing `AGENTS.md` sama persis;
- terminal menyatakan update dilewati.

### Mode Non-Interaktif

```powershell
$env:GROQ_API_KEY="gsk_your_key"
devmap init
Remove-Item Env:GROQ_API_KEY
```

Jika existing `AGENTS.md` ditemukan tanpa prompt interaktif:

- file tidak diubah;
- terminal meminta user menjalankan `init` secara interaktif untuk konfirmasi.

Automated test:

```powershell
pnpm --filter devmap exec tsx --test test/init-and-errors.test.ts
```

---

## 9. Error Dan Recovery Testing

### Project Tidak Ada

```powershell
pnpm dev:cli -- analyze "Z:\path-that-does-not-exist"
```

Expected:

- exit code gagal;
- pesan path tidak ditemukan;
- tip actionable;
- tanpa raw stack trace.

### API Key Tidak Ada

```powershell
Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
pnpm dev:cli -- init
```

Expected:

- API key diminta atau command menjelaskan cara memberikannya;
- config parsial tidak dibuat.

### API Key Invalid

```powershell
$env:GROQ_API_KEY="invalid-key"
pnpm dev:cli -- init
Remove-Item Env:GROQ_API_KEY
```

Expected:

- pesan key invalid;
- config valid sebelumnya tidak ditimpa;
- tanpa raw provider stack trace.

### Malformed `package.json`

Buat project sementara dengan JSON invalid lalu jalankan analyze.

Expected:

- analysis tetap selesai;
- framework fallback dari source tetap bekerja;
- warning disimpan pada snapshot;
- user diarahkan memperbaiki `package.json` dan menjalankan `--fresh`.

---

## 10. Cross-Version Dan CI Testing

Verifikasi Windows Node.js 18 dan 20:

```powershell
npx -p node@18 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
npx -p node@20 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
```

GitHub Actions menguji:

- Windows, Ubuntu, dan macOS;
- Node.js 18, 20, dan 22;
- frozen install;
- CLI test;
- CLI build;
- CLI smoke test;
- web build;
- package tarball smoke test.

Sebelum merge, cek:

```powershell
gh pr checks
```

Seluruh job wajib hijau.

---

## 11. Testing Landing Page

Development:

```powershell
pnpm dev:web
```

Production build:

```powershell
pnpm build:web
```

Expected:

- `astro check` menghasilkan 0 error, 0 warning, dan 0 hint;
- `astro build` membuat static route `/index.html`;
- Astro dependency tetap berada di versi yang kompatibel dengan Node 18
  (`astro@5.7.14` saat ini);
- folder placeholder di `apps/web/src/` tetap berisi README supaya struktur
  kosong landing page terdokumentasi.

Preview:

```powershell
pnpm preview:web
```

---

## Checklist Sebelum Commit

```powershell
pnpm test:cli
pnpm build:cli
pnpm build:web
git diff --check
git status --short
```

Pastikan:

- seluruh test lulus;
- CLI dan web berhasil dibuild;
- tidak ada API key;
- tidak ada `.devmap/`, `dist/`, `artifacts/`, atau `node_modules/` yang staged;
- `PROGRESS.md`, `TEST.md`, atau `DEBUG.md` diperbarui bila relevan.

Review staged files:

```powershell
git diff --cached --stat
git diff --cached
```
