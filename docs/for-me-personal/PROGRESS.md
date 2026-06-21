# Progress DevMap

Terakhir diperbarui: 2026-06-21

## Update 2026-06-21

### Snapshot Accuracy For Mixed Workspaces

- Project metadata sekarang memisahkan primary `framework` dari daftar
  `frameworks` yang ditemukan pada package workspace.
- DevMap sendiri diklasifikasikan sebagai `node-cli` monorepo dengan primary
  framework `unknown` dan workspace framework `astro`, bukan Next.js.
- Astro detection saat ini hanya memakai dependency dan pola page `.astro`;
  belum ada deep Astro analyzer.
- Documentation feature map memprioritaskan root README, AGENTS, CONTRIBUTING,
  dan PRD sebelum README internal di assets/package.
- Static file purpose menjelaskan tanggung jawab file dan tidak lagi memakai
  template daftar export yang diawali `exposes`.
- AI flow menyebut Groq dan OpenRouter sebagai adapter provider alternatif.
- Critical scoring memberi bobot lebih besar pada execution owners seperti
  project map dan file scanner, serta menurunkan shared types/constants.
- Regression fixture mixed CLI/Astro dan full suite lulus dengan 118 test.

## Update 2026-06-20

### OpenRouter MVP Provider

- `devmap init` sekarang menampilkan selector panah untuk Groq dan OpenRouter.
- Setup OpenRouter memvalidasi API key lalu meminta model dengan default
  `openrouter/free` ketika user langsung menekan Enter.
- Model OpenRouter yang diketik user, baik gratis maupun berbayar, disimpan dan
  selalu diprioritaskan tanpa hidden fallback dari DevMap.
- `devmap config model <model-id>` dapat mengganti pilihan; `auto` pada
  OpenRouter kembali ke `openrouter/free`.
- `ask`, `analyze`, dan `doctor` sekarang memakai provider factory berdasarkan
  config, bukan membuat Groq client secara langsung.
- OpenRouter completion, streaming SSE, usage normalization, validasi key, dan
  native ordered `models` request sudah memiliki regression tests.
- Focused tests dan full CLI unit suite lulus dengan 116 test.

### Standalone React Detection

- Framework detector sekarang mengenali standalone React dari dependency
  `react`, browser runtime/tooling, dan bukti JSX/TSX source.
- Next.js tetap memiliki precedence karena Next juga memakai React.
- Folder generik `src/app/` tidak lagi otomatis dianggap Next.js; fallback
  source membutuhkan `app/page`, `app/layout`, `app/route`, atau Next config.
- React peer dependency tanpa runtime app tidak diklasifikasikan sebagai
  framework React, sehingga component library tidak menjadi false positive.
- Entry detector sekarang mengenali `main.tsx` sebagai browser entry point.
- Packed-package E2E mencakup fixture React selain Next.js dan Express.

### Project Classification Dan Start-Here Ranking

- Agent index sekarang memisahkan `framework`, `projectType`, dan
  `workspaceType`; DevMap terdeteksi sebagai TypeScript `node-cli` monorepo
  tanpa memalsukan framework baru.
- Package manifest utama dipilih berdasarkan bentuk project, sehingga summary
  CLI memakai description package CLI dan bukan statistik jumlah file.
- Deteksi language memakai dominasi source agar sedikit file config JS tidak
  mengubah TypeScript codebase menjadi `mixed`.
- `criticalFiles` index memprioritaskan executable entry point, CLI
  orchestrator, flow owner, dan feature owner sebelum importance/import count.
- Fresh static validation menghasilkan urutan `index.ts`, `analyze.ts`, lalu
  `projectMap.ts`; `groq.ts` tidak lagi mendahului analysis flow utama.
- `sourcePriority` dan behavioral flow dipertahankan; keduanya sudah tersedia
  sebelum perubahan ini dan kini memiliki regression coverage bersama.

### Ordered Groq Model Fallback

- Mengganti single fallback dengan chain berbeda untuk `ask`, `analyze`, dan
  `analyze --deep`.
- Chain memakai model Groq aktif dari Qwen, Llama Versatile, GPT-OSS, dan
  Llama Instant sesuai kebutuhan command.
- HTTP 429 tetap mendapat tiga exponential-backoff retry pada model aktif,
  lalu berpindah ke model berikutnya jika limit belum pulih.
- Model unavailable dan HTTP 5xx dapat berpindah model; error API key atau
  request invalid berhenti langsung.
- Resolver menghapus model duplikat dan tetap mendukung field legacy
  `fallbackModel` untuk kompatibilitas client.
- Model list diverifikasi melalui endpoint Groq akun development pada
  2026-06-20 tanpa mencetak atau menyimpan API key.

### AST Analyzer Dan Agent Navigation

- Menambahkan analyzer registry dengan output `FileAnalysis` yang konsisten.
- `.ts`, `.tsx`, `.js`, dan `.jsx` sekarang dianalisis memakai `ts-morph`
  untuk imports, exports, symbols, line number, exported state, dan async state.
- File source lain tetap memakai heuristic analyzer; tipe yang tidak dikenal
  memakai fallback low-confidence.
- Snapshot v1 tetap mempertahankan field lama dan menambah analyzer id,
  analysis confidence, serta symbol metadata.
- `devmap analyze` sekarang menulis `.devmap/index.json` dan satu feature map
  per fitur di `.devmap/features/`, termasuk saat snapshot cache dipakai ulang.
- Generated `DEVMAP.md` dan block `AGENTS.md` memakai urutan index, feature map,
  source priority, lalu full snapshot sebagai last resort.
- Feature detector memisahkan documentation, web landing, CLI commands,
  analysis engine, snapshot engine, dan AI integration sebelum technical
  feature attribution.
- False-positive Authentication pada source DevMap sendiri dihapus dengan
  mensyaratkan bukti path, import, atau symbol, bukan sekadar kata di content.
- Validasi manual pada root DevMap menghasilkan enam feature tanpa
  Authentication palsu; index berukuran sekitar 4.5 KB.
- Structural flows sekarang menjelaskan aksi nyata seperti scan, analyzer
  selection, ProjectMap build, snapshot persistence, dan index generation,
  bukan mengulang daftar dependency.
- Critical files pada index memprioritaskan executable entry point, feature
  entry point, dan behavioral support files; `ai/types.ts` tidak lagi masuk
  hanya karena import count tinggi.
- Full CLI suite lulus 96/96, TypeScript typecheck dan production build lulus,
  serta packed tarball E2E lulus untuk fixture Next.js dan Express.

## Update 2026-06-19

### Onboarding Command

- `devmap onboarding` ditambahkan sebagai kandidat MVP 0.1.0, dengan alias
  `devmap onboard`.
- Command membaca `.devmap/snapshot.json` dan menghasilkan guide berbasis
  snapshot tanpa membutuhkan AI call.
- Output human berisi Project Overview, Recommended Reading Path, Feature Map,
  Important Flows, Change Impact Notes, dan Agent Workflow.
- `devmap onboarding --write` menulis `ONBOARDING.md`.
- `devmap onboarding --json` menghasilkan satu dokumen JSON untuk agent,
  editor, atau script.
- README, PRD, command docs, roadmap, design docs, dan CLI README diperbarui
  supaya onboarding tidak lagi tercatat sebagai future-only command.
- Renderer onboarding direfaktor menjadi guide pemahaman untuk developer dan
  AI agent: pembuka menjelaskan tujuan project, mental model, konsep utama,
  area penting untuk dibaca, flow penting, dan rekomendasi mulai membaca.
- Default bahasa onboarding tetap English, sementara `--language id` dan prompt
  interaktif `--write` tetap dapat menghasilkan Bahasa Indonesia.

## Update 2026-06-18

### Landing Page Astro Migration

- Landing page `apps/web` dimigrasikan dari Vue 3 + Vite ke Astro + Tailwind.
- Entry point sekarang memakai `src/pages/index.astro` dan layout dasar
  `src/layouts/BaseLayout.astro`.
- Section landing tetap dipisah per komponen di
  `src/components/landing/*.astro`, dengan komentar konten lama dipertahankan
  sebagai panduan implementasi UI berikutnya.
- Struktur placeholder ditambahkan untuk `src/assets`, `src/data`, `src/lib`,
  `src/scripts`, dan `src/components/ui`, masing-masing dengan README singkat
  tentang isi folder nantinya.
- Tailwind tetap dipakai melalui `src/styles/global.css`, `postcss.config.js`,
  dan `tailwind.config.js`.
- Astro dipin ke `5.7.14` karena `astro@latest` saat ini membutuhkan Node
  `>=22.12.0`, sementara DevMap masih menargetkan Node.js 18+.
- Build web berhasil dengan `astro check && astro build`.

## Update 2026-06-17

### Snapshot Tier 1 Enrichment

- `fileIndex` sekarang menyimpan metadata navigasi Tier 1: `purpose`, `scope`,
  `featureRefs`, `searchTerms`, dan `importance`.
- Scope file diklasifikasikan berdasarkan responsibility (`api`, `ui`,
  `database`, `config`, `service`, `cli`, `test`, `docs`, `unknown`) tanpa
  mensyaratkan framework tertentu.
- Feature metadata diperkaya dengan `purpose`, `files`, `entryPoints`,
  `searchTerms`, dan `confidence`.
- Snapshot sekarang memiliki `flows` minimal untuk high-confidence features.
  Flow masih sederhana dan belum memakai call graph.
- Analyze dapat menjalankan AI enrichment batched untuk purpose/searchTerms:
  maksimal 20 file per call, fallback aman jika gagal.
- Context Builder memakai `fileIndex.searchTerms`, `feature.searchTerms`,
  `featureRefs`, `scope`, `importance`, dan `purpose` sebagai sinyal retrieval.
- Snapshot reader memberi default aman untuk snapshot lama agar `ask` tetap
  berjalan sambil user bisa regenerate snapshot.

### Ask Retrieval Strengthening

- `QuestionContext` sekarang menyimpan `expandedTerms` selain `intent`,
  `keywords`, `confidence`, `relevantFiles`, dan `topScore`.
- `devmap ask` dapat menjalankan query-expansion Groq ringan sebelum scoring.
  Respons harus berupa JSON array dan hanya dipakai sebagai retrieval terms.
- Expanded terms ikut ranking dengan bobot lebih rendah dari keyword langsung,
  sehingga direct match tetap mengalahkan inferred match.
- Confidence mengikuti batas eksplisit: `high` untuk skor 70+, `medium` untuk
  40+, dan `low` di bawah 40. File di bawah skor 25 tetap dikeluarkan.
- Low-confidence context tidak dikirim ke model jawaban. Command memberi
  jawaban lokal yang menjelaskan bahwa tidak ada strong match dan menyarankan
  langkah investigasi.
- Prompt `ask` sekarang mengirim `EXPANDED_TERMS` dan memperingatkan model agar
  memperlakukan expanded terms sebagai hint retrieval, bukan fakta project.
- Dokumentasi publik diperbarui untuk menjelaskan confidence, threshold,
  query expansion, dan low-confidence behavior.
- Focused tests hijau untuk context builder, ask command, dan AI prompt
  contract.

## Update 2026-06-16

### Ask Output Polish

- Human-readable `devmap ask` sekarang hanya menampilkan path pada bagian
  `Relevant Files`; alasan scoring tetap tersedia di `--json`.
- Query understanding memisahkan intent umum (`add_feature`, `change`,
  `debug`, `explain`, `navigate`, `general`) dari keyword pencarian agar
  action word seperti `add`, `change`, atau `where` tidak mengganggu ranking.
- Retrieval sekarang menyimpan `confidence` (`high`, `medium`, `low`) dan
  `topScore` pada `QuestionContext`.
- Minimum relevance threshold mencegah file dengan skor lemah dikirim hanya
  karena menjadi kandidat terbaik dari hasil yang sama-sama tidak relevan.
- Jika tidak ada file melewati threshold, `relevantFiles` kosong dan `ask`
  memberi jawaban lokal low-confidence tanpa memanggil Groq.
- Context keyword extraction mengabaikan connector word English seperti `to`
  dan `in` agar file seperti `doctor.ts` tidak menang hanya karena partial
  stop-word match.
- Scoring path/export sekarang memprioritaskan exact search term dibanding
  substring match, sehingga ranking lebih stabil untuk berbagai jenis
  pertanyaan.
- Prompt `ask` sekarang meminta jawaban langsung, tidak mengulang pertanyaan,
  tidak mengulang section/sentence, dan tidak memberi contoh kode panjang
  kecuali user memintanya eksplisit.
- Prompt `ask` menerima intent generik dan diarahkan untuk memulai dari file
  atau fungsi existing yang tersedia di context sebelum menyarankan file baru.
- Context file sudah menyiapkan field future-oriented seperti `exports`,
  `topFunctions`, dan `purpose`; extraction fungsi lengkap belum masuk scope.
- Scoring kembali memakai data project map utama seperti route metadata dan
  entry points agar `ask` tetap navigation helper berbasis snapshot.
- Focused tests mencakup keyword extraction, ranking anti stop-word, output
  terminal ringkas, intent extraction generik, relevance confidence, threshold
  low-confidence, dan prompt contract.
- Verification lulus untuk `pnpm test:cli`, `pnpm build:cli`, dan
  `git diff --check`.

### Init UX Polish

- `devmap init` human-mode sekarang menampilkan DevMap welcome brand panel di
  awal command.
- Provider tidak lagi diprompt terpisah karena MVP hanya mendukung Groq.
  Output cukup menampilkan `Provider Groq`, lalu meminta Groq API key.
- Focused verification lulus untuk init dan welcome tests.

## Update 2026-06-15

### Release Hardening 0.1.0

- Versi beta pertama ditetapkan sebagai `0.1.0`.
- Metadata npm sekarang memakai deskripsi dan keyword product yang jelas.
- README package npm menjelaskan instalasi, Groq setup, command, generated
  files, agent JSON output, supported stacks, privacy, dan known scope beta.
- `CHANGELOG.md` mencatat fitur, security/privacy behavior, dan known
  limitations `0.1.0`.
- `docs/releasing.md` mendefinisikan release gates, tarball inspection, first
  npm publish, verification setelah publish, tag GitHub, dan rancangan CD.
- Launch checklist PRD disinkronkan dengan bukti automated test dan CI.
- Feedback external dan benchmarking dipindahkan menjadi post-launch beta
  validation, tanpa mengizinkan claim token savings sebelum ada hasil.

### AI Response Streaming

- Human-readable `devmap ask` dan AI interpretation pada `devmap analyze`
  sekarang memakai Groq server-sent events.
- Delta response direkonstruksi menjadi hasil lengkap untuk token metadata,
  snapshot persistence, dan cache.
- Output ditampilkan progresif per paragraf agar heading, list, table, wrapping,
  dan inline Markdown tetap rapi.
- Provider yang belum memiliki method streaming tetap memakai regular
  completion tanpa mengubah public command behavior.
- Retry rate limit dan model fallback tetap berjalan sebelum stream dibaca.
- `--json` sengaja tidak memakai streaming agar stdout tetap satu dokumen JSON.
- Automated test mencakup SSE yang terpecah antar-network chunk, command
  streaming, snapshot persistence, dan JSON non-streaming.
- Automated test saat ini berjumlah 65 dan seluruhnya lulus.

## Update 2026-06-14

### Agent JSON Output

- Seluruh command MVP mendukung `--json`.
- stdout JSON hanya berisi satu dokumen valid tanpa ANSI, Markdown renderer,
  bullet, separator, atau progress text.
- `analyze --json` mengembalikan snapshot project.
- `ask --json` mengembalikan answer, relevant files, model, dan token usage.
- `doctor --json` mengembalikan diagnostics dan issues terstruktur.
- `config model --json` mengembalikan model state tanpa membocorkan API key.
- `init --json` berjalan non-interaktif dan membutuhkan environment API key
  atau existing config.
- Generated `DEVMAP.md` sekarang mengarahkan AI agent memakai `--json`.

### Model Routing And Config

- Default `devmap ask` memakai `llama-3.1-8b-instant`.
- Standard `devmap analyze` tetap memakai `openai/gpt-oss-20b`.
- `devmap analyze --deep` memakai `openai/gpt-oss-120b`.
- Fallback model memakai `openai/gpt-oss-20b`.
- Command `devmap config model <model>` dapat menetapkan override global tanpa
  mengubah provider atau API key.
- `devmap config model auto` mengembalikan routing default per command.

### Context Builder Token Optimization

- Pertanyaan navigasi English seperti `where` dan `find` sekarang memakai
  maksimal dua file dengan maksimal 60 baris per file.
- Test, spec, dan fixture dikeluarkan dari pertanyaan produk biasa sehingga
  dummy authentication fixture tidak lagi dianggap sebagai fitur production.
- File test dapat dipilih kembali ketika query English menyebut `test`,
  `testing`, `spec`, `fixture`, atau `coverage`.
- Scope English untuk CLI, web UI, dan documentation memberi ranking boost
  tanpa melakukan hard exclusion terhadap package lain.
- Benchmark existing tetap mencapai top-1 accuracy 20/20 dan top-3 recall
  20/20.
- Payload `where scanner` pada snapshot DevMap turun dari sekitar 20.844
  karakter menjadi 4.423 karakter sebelum tokenisasi.

### Reliability Fixes

- Groq HTTP 429 sekarang di-retry maksimal tiga kali dengan exponential
  backoff sebelum menampilkan error actionable.
- Snapshot reader memvalidasi setiap entry `fileIndex` sebelum snapshot dipakai
  oleh Context Builder.
- Config yang corrupt atau memiliki schema tidak valid diperlakukan sebagai
  config missing.
- `devmap doctor` membaca versi langsung dari package metadata.
- Marker baru `AGENTS.md` memakai kapitalisasi `DevMap`, sambil tetap mengenali
  marker legacy agar block lama tidak diduplikasi.
- Kontrak stats schema v1 didokumentasikan: `totalFiles` dan `relevantFiles`
  sama-sama menghitung hasil scanner setelah ignore filtering.
- Automated test saat ini berjumlah 47 dan seluruhnya lulus.

### Welcome Brand Panel

- Simbol logo terpisah dan border luar dihapus agar welcome screen lebih bersih.
- Terminal lebar memakai wordmark blok berpinggiran seperti identitas awal.
- Label `DEVMAP CLI`, capability line, dan separator aqua solid memperjelas
  identitas produk sebagai developer tool.
- Perbedaan render glyph Unicode pada sebagian font terminal dicatat sebagai
  known issue untuk compatibility pass berikutnya.
- Terminal lebar memakai wordmark penuh dalam area maksimal 76 kolom.
- Terminal sempit memakai judul `DEVMAP` ringkas agar panel tidak wrap atau
  terpotong.
- Renderer panel dipisahkan agar layout lebar dan sempit dapat diuji langsung.
- Automated test saat ini berjumlah 49 dan seluruhnya lulus.

### Issue-First PR Workflow

- Bug, reliability/security fix, fitur MVP, dan perubahan UX sekarang memakai
  issue GitHub sebelum PR dibuat.
- Implementasi dan verification boleh diselesaikan lokal terlebih dahulu.
- Sebelum commit, push, atau PR, agent berhenti dan memberi title/body issue
  siap pakai kepada maintainer.
- Setelah nomor issue diberikan, PR harus memakai `Closes #N` agar issue
  tertutup otomatis ketika merge.
- Perubahan dokumentasi/proses kecil, typo, dependency maintenance, dan CI
  housekeeping tidak wajib memakai issue.

## Update 2026-06-13

### Packed CLI End-to-End

- Manual tarball test pada project eksternal dengan Groq API key sudah berhasil
  dijalankan oleh maintainer.
- Script `pnpm test:package-e2e` membuat tarball CLI dari source terbaru.
- Tarball dipasang sebagai dependency pada project Next.js dan Express
  sementara, bukan dijalankan langsung dari workspace.
- E2E memverifikasi `--version`, `--help`, `analyze --fresh`, `ask`, `doctor`,
  dan isi snapshot.
- Home directory diisolasi agar config Groq pribadi tidak terbaca dan tes tidak
  memakai quota AI.
- Package smoke test di CI sekarang menjalankan alur distribusi end-to-end ini.

## Update 2026-06-12

### Analyzer Resilience

- `devmap analyze` sekarang tetap menyelesaikan static analysis ketika root
  `package.json` tidak dapat diparse.
- Framework fallback dari struktur source tetap digunakan sehingga project
  Express atau Next.js masih dapat dikenali tanpa dependency metadata.
- Snapshot menyimpan warning bahwa dependency-based detection mungkin tidak
  lengkap.
- Output terminal memberi langkah perbaikan untuk membetulkan `package.json`
  lalu menjalankan `devmap analyze --fresh`.
- Automated test mencakup warning terminal, snapshot persistence, framework
  fallback, dan keberhasilan pembuatan snapshot.

### Terminal Markdown Rendering

- Jawaban AI dari `devmap ask` dan architecture interpretation dari
  `devmap analyze` sekarang dirender sebagai output terminal yang terstruktur.
- Heading memakai accent aqua dan separator.
- Marker Markdown inline seperti bold, italic, strikethrough, link, dan
  backtick tidak lagi tampil mentah.
- Ordered dan unordered list mempertahankan indentasi yang mudah dipindai.
- Markdown table diubah menjadi record vertikal agar tetap terbaca pada
  terminal sempit.
- Prose dibungkus berdasarkan `process.stdout.columns` dengan minimum width
  yang aman.
- Fenced code tetap ditampilkan sebagai source block dan static context tidak
  diproses sebagai Markdown.
- Automated test mencakup heading, inline formatting, list, table, wrapping,
  fenced code, serta integrasi `ask` dan cached `analyze`.

### Testing Guide

- `TEST.md` disusun ulang sebagai panduan testing praktis untuk maintainer.
- Panduan sekarang membedakan source tanpa build, automated test, build `dist`,
  tarball external, `npm exec`, `npm link`, AI live, dan CI/runtime testing.
- Alur tarball menjelaskan cara membuat artifact, install pada project lain,
  mengulang install setelah source berubah, expected result, dan cleanup.
- Source mode dijelaskan sebagai cara tercepat melihat perubahan terbaru tanpa
  build atau install ulang.

### Safe `AGENTS.md` Integration

- `devmap init` sekarang membuat `AGENTS.md` dasar jika file belum ada.
- Existing `AGENTS.md` tidak pernah ditimpa.
- Append DevMap instruction block hanya dilakukan setelah konfirmasi eksplisit
  `y` atau `yes`.
- Mode non-interaktif selalu skip existing `AGENTS.md`.
- Block yang sudah ada tidak ditambahkan ulang.
- Symlink `AGENTS.md` ditolak untuk mencegah write di luar project.
- Automated test pada tahap ini berjumlah 43 dan seluruhnya lulus.

## Update 2026-06-11

### Workflow Agent

- Alur branch `codex/`, commit dengan identitas `devmap-agent`, push branch, dan
  draft pull request sudah diverifikasi.

### Analyzer dan Snapshot

- Snapshot schema versi 1 sudah ditambahkan.
- Snapshot sekarang memiliki project fingerprint untuk stale detection dan
  reuse ketika source tidak berubah.
- Snapshot corrupt, missing, dan unsupported schema sudah dibedakan.
- Project metadata sekarang mencakup nama, framework, language, dan package
  manager.
- Analyzer sekarang mendeteksi routes, API routes, database, dan features.
- Critical files memakai score dan alasan, bukan hanya jumlah import.
- Test fixture dan file test tidak lagi mencemari kesimpulan framework, route,
  service, database, feature, atau entry point production.

### Context Builder

- Context Builder heuristic sudah diimplementasikan secara lokal.
- Ranking memakai path, exported symbols, imports, routes, feature evidence, dan
  critical file signals.
- Pertanyaan Bahasa Indonesia dan English didukung melalui concept aliases.
- Context dapat diperluas satu tingkat ke imported file dan importer terkait.
- Batas context adalah maksimal 5 file dan 200 baris per file.
- File besar memakai relevant line window.
- Path traversal dan symlink escape di luar project root ditolak.
- `devmap ask` sudah memakai Context Builder secara lokal.
- Benchmark 20 pertanyaan mencakup auth, database, route session, halaman,
  layout, payment, dan entry point dalam Bahasa Indonesia dan English.
- Hasil benchmark saat ini: top-1 accuracy 20/20 dan top-3 recall 20/20.
- Alias `nextauth` ditambahkan setelah eval menemukan satu fallback ranking yang
  salah.
- Context Builder sudah siap digunakan sebagai input AI layer.

### AI Ask

- Provider abstraction `AiClient` sudah ditambahkan.
- Groq chat completion memakai endpoint REST resmi tanpa SDK tambahan.
- Default model `ask` menggunakan production model
  `openai/gpt-oss-20b`.
- Fallback model menggunakan `llama-3.3-70b-versatile`.
- Request 429 di-retry maksimal tiga kali memakai exponential backoff dan
  header `retry-after`.
- Invalid API key, rate limit, provider failure, empty response, dan response
  yang tidak valid diterjemahkan menjadi error actionable.
- Prompt `ask` hanya memakai context terpilih dan meminta jawaban dalam bahasa
  yang sama dengan pertanyaan.
- `devmap ask` menampilkan token usage agar benchmarking dapat dilakukan.
- Jika AI belum dikonfigurasi atau gagal, selected static context tetap
  ditampilkan.
- Automated test AI memakai fake provider sehingga tidak menggunakan quota.

### AI Analyze

- Standard `devmap analyze` memakai `openai/gpt-oss-20b` ketika config bernilai
  `auto`.
- `devmap analyze --deep` memakai `llama-3.3-70b-versatile`.
- Prompt hanya mengirim compact static snapshot, bukan full raw source.
- Interpretasi arsitektur menyebut entry point, critical file, route, feature,
  database, service, dan relationship yang didukung snapshot.
- Hasil AI, model, generated time, dan token usage disimpan di snapshot.
- Project yang tidak berubah memakai cached AI interpretation tanpa API call
  baru.
- `--fresh` memaksa static analysis dan AI interpretation baru.
- Jika AI gagal, static analysis dan snapshot tetap berhasil.
- Automated test AI memakai mock provider dan tidak menggunakan quota.

### Doctor Diagnostics

- `devmap doctor` sekarang menampilkan versi DevMap, Node.js, OS/arsitektur,
  lokasi project, framework, package manager, provider, config, dan snapshot.
- Node.js di bawah versi 18 ditandai sebagai unsupported.
- Model `auto` di-resolve ke model aktual `openai/gpt-oss-20b`.
- API key divalidasi melalui endpoint daftar model Groq.
- Availability selected model ikut diperiksa.
- Snapshot dibedakan menjadi valid, missing, corrupt, dan unsupported schema.
- API key dan raw stack trace tidak pernah ditampilkan.
- Automated test saat ini berjumlah 38 dan seluruhnya lulus.

### Distribusi npm

- Package CLI publik sekarang bernama `devmap`, sedangkan root private workspace
  bernama `devmap-workspace`.
- Allowlist package hanya memasukkan `dist`; npm tetap menyertakan
  `package.json`, `README.md`, dan `LICENSE`.
- Script `prepack` selalu membangun CLI sebelum tarball dibuat.
- Source, test, `.devmap`, fixture `.env`, dan fixture `node_modules` tidak lagi
  masuk tarball.
- Tarball `devmap-0.1.0.tgz` berhasil dijalankan melalui `npm exec` untuk
  `devmap --version` dan `devmap --help`.
- GitHub Actions memiliki package smoke test setelah seluruh matrix CI lulus.

### Cross-Platform CI

- GitHub Actions matrix sudah ditambahkan untuk:
  - Ubuntu, Windows, dan macOS
  - Node.js 18, 20, dan 22
- Workspace diturunkan dari pnpm 11 ke pnpm 10.34.2 agar kompatibel dengan
  Node.js 18 dan 20.
- Frozen install, test CLI, build CLI, smoke CLI, dan build web dijalankan di CI.
- Windows Node.js 18/20 sempat gagal karena shell wildcard
  `test/*.test.ts`.
- Test runner cross-platform `packages/cli/test/run-tests.ts` sudah dibuat.
- Runner sudah diverifikasi langsung pada Windows dengan Node.js 18.20.8 dan
  20.20.2; keduanya lulus 20/20 test.

### Commit Terkait

```text
07b62d2 Add cross-platform CI with pnpm 10
745f1ed Fix test discovery on Windows
```

### Prioritas Berikutnya

1. Pastikan rerun GitHub Actions hijau pada seluruh 9 kombinasi.
2. Lakukan manual verification Groq pada project nyata.
3. Uji `init`, `analyze`, `ask`, dan `doctor` dari tarball pada project nyata.
4. Tambahkan streaming output untuk jawaban AI jika waktu MVP masih tersedia.

## Status Saat Ini

DevMap sekarang sudah disiapkan sebagai monorepo pnpm yang berjalan, dengan
fondasi CLI yang sudah fungsional. Posisi proyek masih berada di Phase 1 sesuai
roadmap: fokus ke static analysis dulu, belum masuk jawaban AI.

Saat ini CLI sudah bisa:

- Menampilkan welcome screen dengan ASCII wordmark DevMap berwarna aqua ketika
  `devmap` dijalankan tanpa command.
- Menampilkan root help `devmap --help` dengan tema aqua/gray.
- Menampilkan output command dengan warna tema yang konsisten untuk section,
  status, key-value, list item, dan catatan.
- Membuat konfigurasi lokal DevMap dengan `devmap init`.
- Menganalisis project dan menyimpan `.devmap/snapshot.json`.
- Mendeteksi source file, import, entry point, critical file, dan external service
  yang dikenal.
- Menjawab pertanyaan secara statis dengan mencari file yang kemungkinan relevan.
- Menjalankan diagnostics setup dengan `devmap doctor`.
- Menjalankan automated test terhadap fixture Next.js dan Express.
- Menyediakan landing page DevMap berbasis Vue dan Vite.
- Menangani command failure tanpa menampilkan raw stack trace.
- Menjalankan setup wizard `devmap init` dengan validasi Groq API key.
- Membuat `DEVMAP.md` sebagai panduan reusable untuk developer dan AI agent.

## Ringkasan Update

### Setup Workspace

- Root `package.json` diperbarui supaya cocok dengan workflow monorepo yang ada
  di dokumentasi.
- Script root ditambahkan:
  - `pnpm dev:cli`
  - `pnpm build:cli`
  - `pnpm test:cli`
- Root package ditandai sebagai `private` karena repo ini adalah workspace root.
- Metadata project diperbarui memakai deskripsi DevMap dan license MIT.

### Setup Package CLI

- Package CLI publik memakai nama `devmap` agar `npx devmap` bekerja.
- Entry binary `devmap` ditambahkan dan diarahkan ke `./dist/index.js`.
- Welcome screen aqua ditambahkan untuk command `devmap` tanpa argumen. Desainnya
  memakai ASCII wordmark DevMap sebagai brand signal, memakai warna truecolor
  `#2EE6D6`, lalu isi di bawahnya tetap ringkas dan command-focused.
- Script package CLI ditambahkan:
  - `pnpm --filter devmap dev`
  - `pnpm --filter devmap build`
  - `pnpm --filter devmap test`
- `commander` dipasang di versi `^12.0.0` supaya tetap kompatibel dengan
  requirement Node.js 18+ yang tertulis di dokumentasi.
- Node types ditambahkan ke `tsconfig.json` supaya TypeScript mengenali
  `process`, `console`, dan import `node:*`.
- Root help kustom ditambahkan supaya `devmap --help` mengikuti tema terminal
  DevMap, bukan output default Commander.

### Kerapian Git

- `.gitignore` ditambahkan dengan isi:
  - `node_modules/`
  - `dist/`
  - `.devmap/`
  - `.env`
  - `.env.*`
  - `*.log`
- File `node_modules/.pnpm-workspace-state-v1.json` yang sebelumnya terlanjur
  tracked sudah dikeluarkan dari tracking Git tanpa menghapus file lokalnya.
- Policy pnpm untuk build script `esbuild` ditambahkan karena dibutuhkan oleh
  `tsx`.

### Automated Testing

- Test runner memakai built-in `node:test` melalui `tsx`, sehingga tidak perlu
  menambah framework test baru.
- Script test CLI sekarang menjalankan unit/integration test dan TypeScript
  type-check:
  - `pnpm --filter devmap test`
  - `pnpm --filter devmap test:unit`
  - `pnpm --filter devmap test:types`
- Fixture Next.js mencakup:
  - App Router
  - import lokal dengan suffix `.js`
  - NextAuth
  - Prisma
  - `.env` dan `node_modules` untuk memastikan ignore rules bekerja
- Fixture Express mencakup:
  - server entry point
  - route lokal
  - Stripe
- Tujuh automated tests sudah tersedia untuk scanner, framework detector,
  dependency graph, service detector, project map, dan snapshot persistence.

### Landing Page

- Landing page DevMap sudah tersedia di `apps/web`.
- Stack web:
  - Vue 3
  - Vite
  - Vue Router
  - Tailwind CSS
- Root workspace menyediakan:
  - `pnpm dev:web`
  - `pnpm build:web`
  - `pnpm preview:web`
- Production build landing page sudah berhasil.

## File Yang Sudah Diimplementasikan

### `packages/cli/src/index.ts`

Entry point utama untuk CLI.

Tanggung jawab:

- Menampilkan welcome screen ketika user menjalankan `devmap` tanpa command.
- Menampilkan root help bertema ketika user menjalankan `devmap --help`,
  `devmap -h`, atau `devmap help`.
- Membuat command utama `devmap` menggunakan Commander.
- Mendaftarkan command MVP:
  - `init`
  - `analyze`
  - `ask`
  - `doctor`
- Menyediakan `--version` dan bantuan command.

### `packages/cli/src/utils/welcome.ts`

Renderer welcome screen untuk first-run experience.

Tanggung jawab:

- Menampilkan ASCII wordmark DevMap berwarna aqua `#2EE6D6`.
- Menampilkan tagline `Understand Any Codebase.`
- Menampilkan status snapshot project.
- Menampilkan quick start:
  - `devmap init`
  - `devmap analyze`
- Menampilkan daftar popular commands seperti `analyze`, `explain`, `ask`,
  `docs`, dan `onboard`.

### `packages/cli/src/utils/help.ts`

Renderer root help bertema.

Tanggung jawab:

- Menampilkan usage, daftar command, options, dan link repo dengan warna tema.
- Menjaga `devmap --help` tetap konsisten dengan visual terminal DevMap.

### `packages/cli/src/commands/init.ts`

Command setup awal.

Perilaku saat ini:

- Membuat `~/.devmap/config.json`.
- Mengatur Groq sebagai default provider.
- Meminta API key secara interaktif atau membaca `GROQ_API_KEY`.
- Memvalidasi API key langsung ke Groq.
- Memakai API key lama jika user menekan Enter saat config sudah tersedia.
- Mendeteksi framework project aktif.
- Membuat folder `.devmap/`.
- Memastikan `.devmap/` masuk ke `.gitignore` project aktif.
- Membuat `DEVMAP.md` tanpa menimpa file yang sudah ada.

### `packages/cli/src/ai/groq.ts`

Validator Groq untuk setup MVP.

Tanggung jawab:

- Memvalidasi API key melalui endpoint model Groq.
- Menerjemahkan invalid key, network failure, dan provider failure menjadi error
  yang actionable.

### `packages/cli/src/utils/errors.ts`

Global command error boundary.

Tanggung jawab:

- Menangkap error dari command CLI.
- Menampilkan pesan ringkas tanpa raw stack trace.
- Memberi saran tindakan berikutnya.
- Menerjemahkan error umum seperti `ENOENT`, `EACCES`, dan `EPERM`.

### `packages/cli/src/utils/prompt.ts`

Adapter prompt interaktif berbasis `node:readline/promises`.

Tanggung jawab:

- Membaca provider dan API key saat `devmap init`.
- Menutup interface input setelah wizard selesai atau gagal.

### `packages/cli/src/utils/devmapFile.ts`

Generator `DEVMAP.md`.

Isi utama file:

- lokasi snapshot dan config DevMap
- workflow `analyze`, `ask`, dan `doctor`
- panduan untuk AI agent agar memakai snapshot sebelum eksplorasi buta
- aturan untuk tidak mengedit `.devmap/`
- peringatan agar API key tidak pernah di-commit

File yang sudah ada tidak akan ditimpa.

### `packages/cli/src/commands/analyze.ts`

Command untuk analisis project secara statis.

Perilaku saat ini:

- Melakukan scan pada folder project yang ditargetkan.
- Membuat project map.
- Menampilkan nama project, framework, jumlah file, jumlah line, entry point,
  critical file, dan external service.
- Menyimpan snapshot ke `.devmap/snapshot.json`.
- Mendukung flag `--deep` dan `--fresh` di level CLI.

Output `--deep` saat ini masih sederhana dan statis. Penjelasan AI yang lebih
kaya akan masuk di Phase 2.

### `packages/cli/src/commands/ask.ts`

Command pertanyaan statis.

Perilaku saat ini:

- Membaca `.devmap/snapshot.json`.
- Jika snapshot belum ada, command menjalankan quick analyze dulu.
- Mengambil keyword dari pertanyaan user.
- Memberi skor file berdasarkan kecocokan keyword terhadap path file dan exported
  symbol.
- Menampilkan file paling relevan dan preview singkat.

Command ini belum memanggil AI. Di Phase 2, bagian jawaban statis akan diganti
dengan output Groq yang context-aware.

### `packages/cli/src/commands/doctor.ts`

Command diagnostics setup.

Perilaku saat ini:

- Menampilkan versi Node.js.
- Mengecek apakah config DevMap sudah ada.
- Mengecek apakah API key sudah diset.
- Mengecek apakah snapshot project sudah ada.
- Memberi warning jika API key Groq belum tersedia.

### `packages/cli/src/analyzers/fileScanner.ts`

Scanner filesystem rekursif.

Tanggung jawab:

- Menelusuri folder project.
- Menerapkan ignore rules.
- Membaca isi file.
- Mengembalikan path, absolute path, extension, ukuran file, jumlah line, dan
  konten file.

### `packages/cli/src/analyzers/filterEngine.ts`

Engine ignore rule untuk proses scanning.

Saat ini mengabaikan path umum yang generated atau tidak aman dikirim ke proses
analisis:

- `.git`
- `.devmap`
- `.next`
- `.turbo`
- `.vercel`
- `build`
- `coverage`
- `dist`
- `node_modules`
- `out`
- `.env*`
- file log, source map, lockfile, dan asset binary umum

### `packages/cli/src/analyzers/frameworkDetector.ts`

Detector framework.

Deteksi saat ini:

- Next.js terdeteksi dari dependency `next` atau folder `app/`.
- Express terdeteksi dari dependency `express` atau file entry server umum.
- Jika tidak cocok, hasilnya `unknown`.

### `packages/cli/src/analyzers/dependencyGraph.ts`

Builder import graph.

Tanggung jawab:

- Melakukan parsing static untuk `import`, `export from`, dan `require()`.
- Resolve import relatif lokal.
- Mendukung resolve source TypeScript ketika import memakai suffix `.js`.
- Menghitung reference antar file.

### `packages/cli/src/analyzers/entryPoints.ts`

Detector entry point.

Logika saat ini:

- Memprioritaskan source file saja.
- Mendeteksi pola entry point umum seperti:
  - `page.tsx`
  - `layout.tsx`
  - `middleware.ts`
  - `server.ts`
  - `app.ts`
  - `index.ts`
  - `route.ts`
- Juga memasukkan source file yang meng-import file lain tetapi tidak di-import
  oleh file lokal lain.

### `packages/cli/src/analyzers/serviceDetector.ts`

Detector external service.

Logika saat ini:

- Membaca dependency package dan import package yang benar-benar ada di source.
- Mendeteksi service yang dikenal seperti Prisma, Supabase, Stripe, NextAuth,
  Midtrans, Resend, Cloudinary, Firebase, OpenAI, dan Groq.
- Menghindari false positive dari teks dokumentasi atau dari file detector itu
  sendiri.

### `packages/cli/src/analyzers/projectMap.ts`

Builder project map.

Tanggung jawab:

- Mengorkestrasi scanner, graph builder, framework detector, entry detector, dan
  service detector.
- Membuat bentuk data snapshot yang dipakai oleh `analyze` dan `ask`.
- Menyimpan metadata per file:
  - hash
  - imports
  - exported symbols
  - line count

### `packages/cli/src/cache/fileHash.ts`

Utility kecil untuk hashing MD5.

Dipakai untuk mengenali perubahan konten file pada snapshot dan behavior cache
di masa depan.

### `packages/cli/src/cache/snapshot.ts`

Helper persistensi snapshot.

Tanggung jawab:

- Menulis `.devmap/snapshot.json`.
- Membaca snapshot yang sudah ada.
- Menyediakan path canonical untuk snapshot.

### `packages/cli/src/utils/config.ts`

Helper global config.

Tanggung jawab:

- Membaca `~/.devmap/config.json`.
- Menulis `~/.devmap/config.json`.
- Menyediakan path canonical untuk config.

### `packages/cli/src/utils/gitignore.ts`

Helper Git ignore.

Tanggung jawab:

- Memastikan `.devmap/` ada di `.gitignore` project.
- Menghindari duplikasi entry `.devmap/`.

### `packages/cli/src/utils/output.ts`

Helper output terminal.

Tanggung jawab:

- Menjaga output command tetap konsisten.
- Menyediakan token warna tema:
  - aqua `#2EE6D6`
  - gray
  - green
  - yellow
  - red
- Menyediakan helper untuk section, step, success message, warning, error,
  baris key-value, list item, note, dan code block.

### `packages/cli/test/analyzers.test.ts`

Automated test utama untuk fondasi static analysis.

Coverage saat ini:

- scanner mengabaikan generated path dan secret file
- deteksi Next.js dan Express
- resolve import TypeScript dengan suffix `.js`
- perhitungan reference pada dependency graph
- deteksi external service tanpa false positive
- project map Next.js dan Express
- save/read snapshot

### `packages/cli/test/init-and-errors.test.ts`

Automated test untuk setup dan error handling.

Coverage saat ini:

- konten generator `DEVMAP.md`
- perlindungan agar `DEVMAP.md` tidak tertimpa
- init melalui environment API key
- penolakan provider di luar Groq
- actionable error saat API key tidak tersedia
- error handler tidak membocorkan stack trace
- translasi error path yang tidak ditemukan

### `packages/cli/test/fixtures/`

Project kecil yang dipakai sebagai input analyzer saat test.

Fixture yang tersedia:

- `nextjs-project`
- `express-project`

### `TEST.md`

Panduan testing lokal dan development untuk maintainer.

Mencakup:

- setup environment
- automated test CLI
- development CLI tanpa build
- testing hasil build
- testing `devmap init` dan Groq API key
- testing `DEVMAP.md`
- testing error handler
- testing fixture Next.js dan Express
- testing landing page
- checklist sebelum commit
- testing global install dengan `npm link`

## Verifikasi

Pengecekan berikut sudah berhasil:

```bash
pnpm --filter devmap test
pnpm --filter devmap build
pnpm --filter @devmap/web build
node packages\cli\dist\index.js --help
node packages\cli\dist\index.js init
node packages\cli\dist\index.js analyze
node packages\cli\dist\index.js ask "where is the scanner logic"
node packages\cli\dist\index.js doctor
```

## Limitasi Saat Ini

- Integrasi AI belum diimplementasikan.
- `ask` saat ini hanya mencari file relevan dan menampilkan preview.
- `analyze --deep` saat ini masih menampilkan breakdown statis sederhana.
- Dukungan framework masih level MVP: Next.js, Express, atau unknown.
- Snapshot yang dibuat bersifat lokal dan sengaja di-ignore oleh Git.
- `devmap doctor` belum memvalidasi API key, network, dan availability model.
- Input API key interaktif belum disamarkan saat diketik.
- Test belum mencakup edge case project besar, malformed `package.json`, dan
  circular dependency.

## Rekomendasi Langkah Berikutnya

1. Samarkan input API key saat wizard interaktif.
2. Tingkatkan `devmap doctor` untuk validasi API key, network, dan model.
3. Tambahkan test untuk malformed project dan circular dependency.
4. Tambahkan abstraction AI client dan model routing.
5. Tambahkan Context Builder dengan batas 3–5 file.
6. Tambahkan prompt template untuk `analyze` dan `ask`.

## Snapshot Scanner Ignore: Agent Development Metadata

**Tanggal:** 2026-06-18

DevMap sekarang mengabaikan folder `.agent/` dan `.agents/` saat scan project.
Folder tersebut dipakai untuk metadata/skill AI agent saat development dan
tidak boleh muncul sebagai fitur produk di snapshot.

Verifikasi:

```powershell
pnpm --filter devmap exec tsx --test test/analyzers.test.ts
```

## Snapshot Function Metadata

**Tanggal:** 2026-06-18

Snapshot `fileIndex` sekarang menyimpan `topFunctions`, yaitu daftar ringkas
fungsi atau symbol kode penting beserta line number, tipe symbol, status export,
dan status async. Metadata ini menjadi fondasi untuk jawaban `ask`, onboarding,
dan flow document tanpa harus membaca raw source terlalu banyak.

Flow minimal juga mulai memakai symbol penting pada label step, sehingga flow
lebih informatif daripada sekadar daftar file.

Tahap lanjutannya menambahkan request/API flows dari route yang terdeteksi ke
dependency lokalnya. Contoh: route API dapat menghasilkan flow
`route.ts -> auth.ts -> db.ts`, yang nanti bisa menjadi bahan awal `FLOW.md`.

Tahap berikutnya menambahkan primary feature entry point, business flow ringkas,
`onboarding.recommendedPath`, dan `changeImpact` file-level. Ini sengaja masih
shallow agar snapshot lebih memahami project tanpa masuk ke symbol graph penuh.

Generated `DEVMAP.md` sekarang memiliki Agent Navigation Contract yang meminta
agent memakai snapshot-first pada implementasi saat itu. Kontrak ini kemudian
diganti pada 2026-06-20 menjadi index-first dan feature-map-first, dengan full
snapshot sebagai fallback. Agent tetap menjalankan `devmap analyze` saat output
hilang dan meminta user menjalankan `devmap init` jika belum terkonfigurasi.

Verifikasi:

```powershell
pnpm --filter devmap exec tsx --test test/analyzers.test.ts test/context-builder.test.ts
```
