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

## Multi-Framework Detection (update0 s.d. update5)

Focused automated tests (suite khusus framework-routes: Astro, Nuxt, Vue,
SvelteKit, Svelte SPA, Fastify, NestJS):

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/framework-routes.test.ts
```

Full suite:

```powershell
pnpm --filter @flaid/devmap test
pnpm --filter @flaid/devmap build
```

Expected: `228 pass / 0 fail` untuk unit suite (node:test via `run-tests.ts`),
build tsc 0 error. Ranah yang di-cover:

- `detectFrameworks`/`detectRoutes` per framework: Astro pages/endpoints + Nuxt
  file routing + SvelteKit `+page`/`+server` + Fastify chained/object-style +
  Nest decorator-class (ts-morph).
- Cross-file: Express router-mount dan Fastify plugin `prefix` compose via
  dependency graph (`FileGraph`).
- Integrasi `createProjectMap`: framework, routes, dan features (Vue Router
  lazy-import, svelte-routing/svelte-spa-router object map) keluar benar.
- Priority: project Nest dengan `@nestjs/platform-express` tetap label
  `nestjs`, bukan `express`.

Manual: `pnpm dev:cli -- analyze` pada project Express + router-mount harus
memunculkan route `/mount/...` yang ter-compose dari prefix + sub-path.

## OpenRouter Provider

Focused automated tests:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/init-and-errors.test.ts test/openrouter-client.test.ts test/doctor.test.ts
```

Manual source test sebaiknya dijalankan dari project fixture atau project luar,
karena `init` menulis `.devmap/`, `DEVMAP.md`, dan kemungkinan `AGENTS.md`:

```powershell
pnpm dev:cli -- init
```

Expected interactive flow:

1. Pilih `OpenRouter` dengan tombol panah lalu tekan Enter.
2. Masukkan OpenRouter API key; key tidak boleh dicetak ulang.
3. Pada `OpenRouter model [openrouter/free]:`, tekan Enter untuk free router
   atau ketik model ID gratis/berbayar yang ingin diuji.
4. Pastikan output menjelaskan command
   `devmap config model <model-id>` untuk mengganti model nanti.
5. Jalankan `devmap doctor` dan `devmap analyze` lalu pastikan
   provider serta model yang tampil sesuai config.

Non-interactive setup dapat memakai:

```powershell
$env:OPENROUTER_API_KEY="your-key"
pnpm dev:cli -- init --json
Remove-Item Env:OPENROUTER_API_KEY
```

Jangan simpan atau menyalin API key nyata ke repository, snapshot, output test,
atau dokumentasi debugging.

## Groq Model Picker And Analyze Command

Focused automated tests:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/init-and-errors.test.ts test/config-command.test.ts test/analyze-ai.test.ts
```

Expected:

- Config lama di `~/.devmap/config.json` yang hanya berisi `apiKey` tetap
  terbaca sebagai Groq dengan `model: "auto"`.
- Setup Groq interaktif menampilkan daftar model Groq setelah API key valid.
- Pilih model dengan arrow key lalu Enter; model tersimpan di global config.
- `devmap config model <model-id>` tetap dapat mengganti model yang tersimpan.
- `devmap analyze --help` tidak menampilkan flag `--deep`.
- OpenRouter setup tetap memakai prompt model text dengan default
  `openrouter/free`.

## Per-Project Model Override (`config model --local`)

Focused automated tests:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/config-local.test.ts test/doctor.test.ts test/analyze-ai.test.ts test/flow-command.test.ts
```

Expected:

- `devmap config model <name> --local` di dalam fixture menulis
  `.devmap/config.local.json` yang isinya cuma field `model`.
- `devmap analyze` / `devmap flow` di fixture memakai model dari local
  override (semua AiCompletionRequest ber-model `local-override-model`).
- Di luar fixture (tanpa local config) tetap memakai model global.
- `devmap doctor` menampilkan `Model ... (project override)` saat local
  override aktif dan `(global)` saat tidak; model yang di-inspek adalah
  model local override.
- Menambahkan `apiKey`/`provider` manual ke `.devmap/config.local.json`
  diabaikan dan memunculkan warning persis sekali:
  `config.local.json only supports "model", ...`.
- `pnpm --filter @flaid/devmap test:unit` â†’ 228 pass / 0 fail;
  `pnpm --filter @flaid/devmap test:types` â†’ 0 error.

Full suite:

```powershell
pnpm --filter @flaid/devmap test:unit
pnpm --filter @flaid/devmap test:types
```

## Mixed Workspace Snapshot Accuracy

Jalankan static analyze pada root DevMap dengan config AI terisolasi:

```powershell
$oldProfile = $env:USERPROFILE
$env:USERPROFILE = Join-Path $env:TEMP "devmap-mixed-workspace-test"
pnpm dev:cli -- analyze . --fresh --json
$env:USERPROFILE = $oldProfile
```

Periksa `.devmap/index.json` dan feature maps. Expected:

- `projectType` adalah `web-app`;
- primary `framework` adalah `astro`;
- `frameworks` memuat `astro`;
- Documentation dimulai dari root `README.md`, bukan README dalam assets;
- purpose `ai/provider.ts` menjelaskan pemilihan provider/model routing dan
  tidak memakai kata `exposes`;
- AI flow menyebut `groq.ts` dan `openrouter.ts`;
- main critical list tetap dimulai dari CLI entry/analyze/project map.

## Ts-Morph Dan Agent Navigation

Focused tests:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/file-analyzers.test.ts test/agent-navigation.test.ts test/analyzers.test.ts test/analyze-ai.test.ts
```

Tes source langsung pada root DevMap tanpa memakai Groq:

```powershell
$root = (Get-Location).Path
$oldProfile = $env:USERPROFILE
$env:USERPROFILE = Join-Path $env:TEMP "devmap-static-validation"
pnpm dev:cli -- analyze "$root" --fresh --json
$env:USERPROFILE = $oldProfile
```

Periksa hasil berikut:

```powershell
Get-Content .devmap\index.json -Raw | ConvertFrom-Json
Get-ChildItem .devmap\features\*.json
Get-Content .devmap\snapshot.json -Raw | ConvertFrom-Json
```

Expected:

- file JS/TS memakai `ts-morph` dengan confidence `high`;
- file Vue/Astro dan source non-JS yang dikenali memakai `heuristic`;
- unknown file memakai `fallback`;
- index tidak memiliki full `changeImpact` atau dependency map;
- semua `features[].map` menunjuk file JSON yang ada;
- structural `flow` menjelaskan urutan perilaku dan tidak hanya berisi
  `Follow dependency` atau salinan daftar feature files;
- `index.json.criticalFiles` dimulai dari executable/feature entry points dan
  tidak mempromosikan type-only hub hanya karena import count;
- project header DevMap berisi `projectType: web-app`,
  `workspaceType: monorepo`, dan language `typescript`, dengan framework
  `astro` (framework-first menang atas `bin` di packages/cli);
- summary menjelaskan TypeScript monorepo, Node.js CLI, package description,
  dan capabilities tanpa file-count filler;
- tiga critical file pertama untuk DevMap adalah `packages/cli/src/index.ts`,
  `packages/cli/src/commands/analyze.ts`, dan
  `packages/cli/src/analyzers/projectMap.ts`;
- feature map Analysis Engine memulai `sourcePriority` dari `projectMap.ts`
  dan flow menjelaskan scan/analyze/build behavior tanpa `Follow dependency`;
- DevMap sendiri tidak mendeteksi Authentication dari README, prompt example,
  onboarding text, atau landing page;
- feature anchor DevMap mengarah ke `projectMap.ts`, `analyze.ts`, dan landing
  `index.astro`, bukan file dokumentasi acak.

## Onboarding Command

Focused automated test:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/onboarding-command.test.ts test/onboarding-model.test.ts test/json-output.test.ts
```

Model layer (new):
- `test/onboarding-model.test.ts` â€” `buildOnboardingModel()` dengan fixture
  nyata (Next.js) dan snapshot kosong; verifikasi semua field `OnboardingModel`
  terisi; validasi priority range (1-4); dukungan bahasa Indonesia; edge case
  snapshot minimal tanpa features/flows.

Manual source-mode check dari root DevMap:

```powershell
$root = (Get-Location).Path
pnpm dev:cli analyze "$root"
pnpm dev:cli onboarding "$root"
pnpm dev:cli onboarding "$root" --json
pnpm dev:cli onboarding "$root" --write
pnpm dev:cli onboarding "$root" --write --language id
```

Catatan: `pnpm dev:cli` memakai `pnpm --filter @flaid/devmap`, sehingga command
source-mode berjalan dari `packages/cli`. Untuk mengetes root workspace DevMap,
selalu kirim path target eksplisit seperti contoh di atas.

Expected result:

- `devmap onboarding` membaca `.devmap/snapshot.json` yang sudah ada.
- Jika snapshot belum ada atau stale, jalankan `pnpm dev:cli analyze` dulu.
- Jika snapshot stale, human output memberi warning dan JSON berisi
  `snapshot.stale: true`.
- JSON output menyertakan `agentInstructions` agar agent mengikuti policy
  index-first dan feature-map-first.
- Human output berfokus sebagai guide pemahaman, bukan file index: What This
  Project Does, Mental Model, Main Concepts, Important Areas to Understand, Key
  Flows, dan Where to Start.
- Setiap file penting dalam reading area menyertakan `Purpose` dan
  `Why read this`, bukan score/import count/export list mentah.
- Entry point kosong di feature/flow tidak boleh ditampilkan sebagai
  `not inferred yet`; field tersebut cukup dihilangkan.
- `--json` menghasilkan satu dokumen JSON tanpa ANSI atau dekorasi terminal.
- `--write` membuat atau memperbarui `ONBOARDING.md` di root project target.
- Di terminal interaktif, `--write` menanyakan bahasa onboarding jika
  `--language` belum diberikan. Default bahasa tetap English.
- `--language en` dan `--language id` melewati prompt, cocok untuk automation
  dan agent.

## Context Builder Ranking

Jalankan focused test ranking dan evaluation:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/context-builder.test.ts test/context-builder-eval.test.ts
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
pnpm --filter @flaid/devmap exec tsx --test test/analyzers.test.ts test/analyze-ai.test.ts test/context-builder.test.ts
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



Periksa `Relevant Files` dan prompt token usage. Query pertama seharusnya
memprioritaskan production CLI source dan memakai context jauh lebih kecil
daripada default lama lima file dengan maksimal 200 baris per file.
Untuk pertanyaan implementasi, jawaban seharusnya langsung menyebut file yang
perlu diperiksa/diedit lebih dulu dan tidak menampilkan contoh kode panjang
kecuali diminta.
Jika confidence rendah, jawaban seharusnya mengatakan tidak ada strong match,
tidak menampilkan `Asking Groq`, dan tidak menyebut file random sebagai sumber
pasti.

## Flow Command

Focused automated test:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/flow-command.test.ts
```

Coverage:

- default run (tanpa AI): note "AI flow narration is not configured" muncul
  sekali, index terminal, file `.devmap/flows/*.md` + `*.mermaid` ter-tulis,
  markdown berisi Purpose + Steps + mermaid block valid tanpa narration;
- `--all` menghasilkan count >= default dan memasukkan route non-API
  (page route) yang tidak muncul di default;
- target exact case-insensitive; target unknown â†’ DevmapError dengan hint
  known flows; target ambigu â†’ DevmapError "matches multiple flows";
- `--json` menghasilkan satu dokumen `FlowResult` yang valid;
- narration success dengan fake `createAiClient` (model = `DEFAULT_AI_MODELS.flowNarration`,
  fallback = `DEFAULT_AI_FALLBACKS.flowNarration`, `maxCompletionTokens: 400`,
  section "How it works" di markdown);
- narration failure dengan fake client yang melempar `DevmapError` â†’ warning,
  `narrated: false`, command tetap menyelesaikan semua flow.

Catatan: semua test tanpa AI wajib inject `loadConfig: async () => null`
karena mesin dev punya config global dengan API key nyata â€” tanpa itu test
akan memanggil AI live.

Manual source-mode check dari fixture (dengan home terisolasi supaya key
nyata tidak terbaca):

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/flow-command.test.ts
pnpm build:cli
$oldProfile = $env:USERPROFILE
$env:USERPROFILE = Join-Path $env:TEMP "devmap-flow-test-home"
node packages\cli\dist\index.js analyze --fresh --project-root packages/cli/test/fixtures/nextjs-project
node packages\cli\dist\index.js flow packages/cli/test/fixtures/nextjs-project
node packages\cli\dist\index.js flow --all packages/cli/test/fixtures/nextjs-project
$env:USERPROFILE = $oldProfile
```

Expected:

- `flow` default menulis flows ter-curate dari snapshot (tanpa AI note hanya
  jika config tidak terbaca);
- `flow --all` menulis set yang lebih besar (termasuk page route);
- target yang tidak dikenal gagal dengan daftar known flows dan exit code 1;
- `flow --json` output dapat di-parse langsung.

## Explain Command

Focused automated test:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/explain-command.test.ts
```

Coverage:

- fail-fast provider: tanpa config â†’ `DevmapError` "requires an AI provider"
  + hint `devmap init`, dan tidak ada file `.devmap/explain/` yang ditulis;
- file mode exact path + suffix unambiguous (`auth.ts` â†’ `lib/auth.ts`);
- feature mode case-insensitive (`authentication` â†’ `Authentication`);
- function mode memakai nama fungsi asli dari `topFunctions` snapshot fixture
  (bukan nama tebakan), `resolvedFile` benar, `contextFiles` berisi file tsb;
- routing AI = `DEFAULT_AI_MODELS.explain` + `DEFAULT_AI_FALLBACKS.explain`;
- ambiguity: 2 file dengan fungsi senama â†’ `DevmapError` "matches multiple
  functions" mencantumkan `file:line`;
- unknown target â†’ `DevmapError` "isn't a known file, feature, or function"
  + `Known features:`;
- `--write` menulis `.devmap/explain/<slug>.md` berisi `# <target>` + answer;
- tanpa `--write` tidak ada file ditulis;
- urutan resolusi feature â†’ file â†’ function.

Catatan desain: untuk function mode, question yang dikirim ke
`buildQuestionContext` adalah `"<fn> in <file>"` â€” keyword murni nama fungsi
tidak match path/symbol ranking, tapi `<file>` pasti cocok.

Manual source-mode check dari fixture:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/explain-command.test.ts
pnpm build:cli
# Tanpa config (backup dulu): ~/.devmap/config.json harus dipindah dulu
#   rename "$env:USERPROFILE\.devmap\config.json" config.json.bak
node packages\cli\dist\index.js explain packages/cli/test/fixtures/nextjs-project/lib/auth.ts
echo "exit code: $LASTEXITCODE"   # harus non-zero
Test-Path packages/cli/test/fixtures/nextjs-project/.devmap/explain   # harus False
#   restore: rename config.json.bak config.json
# Dengan config asli (Groq key nyata):
node packages\cli\dist\index.js explain packages/cli/test/fixtures/nextjs-project/lib/auth.ts
node packages\cli\dist\index.js explain packages/cli/test/fixtures/nextjs-project/Authentication
node packages\cli\dist\index.js explain packages/cli/test/fixtures/nextjs-project/getSession
node packages\cli\dist\index.js explain --write packages/cli/test/fixtures/nextjs-project/lib/auth.ts
Get-Content packages/cli/test/fixtures/nextjs-project/.devmap\explain\lib-auth.md
node packages\cli\dist\index.js explain --json packages/cli/test/fixtures/nextjs-project/lib/auth.ts
```

Expected:

- stream jawaban + baris `Context files:` di terminal;
- target fungsi `getSession` ter-resolve ke `lib/auth.ts`;
- `--write` membuat `.devmap/explain/lib-auth.md`;
- `--json` menghasilkan `ExplainResult` yang valid;
- tanpa config: fail-fast message + exit code 1.

## Model Routing And Override

Focused automated test:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/config-command.test.ts test/analyze-ai.test.ts
```

Expected automatic routing:

- `analyze`: `openai/gpt-oss-20b`
- `analyze` fallback: Qwen 3.6 27B -> Llama 70B Versatile -> Llama 8B Instant

Automated expectations:

- unavailable model immediately advances to the next unique model;
- HTTP 429 performs three retries with delays `1000`, `2000`, and `4000` ms,
  then advances to the next model;
- HTTP 401/403 stops without trying fallback models;
- regular completion and streaming use the same ordered chain;
- a custom configured primary remains first and duplicate fallback IDs are
  removed.

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
pnpm --filter @flaid/devmap exec tsx --test test/json-output.test.ts
```

Manual source-mode checks:

```powershell
pnpm dev:cli analyze --json
pnpm dev:cli flow --json
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
pnpm --filter @flaid/devmap exec tsx --test test/ai-client.test.ts test/analyze-ai.test.ts test/json-output.test.ts
```

Coverage penting:

- SSE event tetap terbaca ketika JSON event terpecah pada network chunk;
- delta dikirim berurutan dan hasil lengkap dikembalikan provider;
- fresh AI interpretation `analyze` memakai streaming jika tersedia;
- hasil lengkap `analyze` tetap disimpan ke snapshot;
- `--json` memakai completion penuh dan tidak memanggil streaming.

Manual live check:

```powershell
$env:GROQ_API_KEY="gsk_your_key"
pnpm dev:cli -- analyze --fresh
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
pnpm --filter @flaid/devmap exec tsx --test test/package-distribution.test.ts
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

- Node.js 22.12 atau lebih baru (engines workspace: `>=22.12`);
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

`pnpm dev:cli` menjalankan package `devmap` melalui `pnpm --filter @flaid/devmap`.
Karena itu current working directory command menjadi `packages/cli`, bukan root
repository. Mode ini bagus untuk mengetes CLI package, tetapi snapshot akan
dibuat di `packages/cli/.devmap/snapshot.json`.

```powershell
pnpm dev:cli
pnpm dev:cli -- --help
pnpm dev:cli -- doctor
pnpm dev:cli -- analyze
pnpm dev:cli -- analyze --fresh
pnpm dev:cli -- flow
```

### Menjalankan DevMap Pada Root Repository DevMap

Gunakan mode ini saat ingin DevMap menganalisis repository DevMap dari root dan
membuat snapshot di `.devmap/snapshot.json`.

Jangan gunakan `pnpm exec tsx ...` dari root workspace, karena `tsx` adalah
dependency package CLI dan tidak selalu tersedia sebagai binary root workspace.
Pakai binary `tsx.cmd` milik `packages/cli` secara langsung:

```powershell
.\packages\cli\node_modules\.bin\tsx.cmd .\packages\cli\src\index.ts analyze --fresh
.\packages\cli\node_modules\.bin\tsx.cmd .\packages\cli\src\index.ts flow
.\packages\cli\node_modules\.bin\tsx.cmd .\packages\cli\src\index.ts doctor
```

Expected:

- `.devmap/snapshot.json` muncul di root repository DevMap;
- bukan di `packages/cli/.devmap/snapshot.json`;
- Flow membaca snapshot root yang baru dibuat.

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
pnpm dev:cli -- analyze packages/cli/test/fixtures/react-project --fresh
```

Hasil penting Next.js:

- framework `nextjs`;
- entry point `app/page.tsx` dan `app/layout.tsx`;
- NextAuth dan Prisma terdeteksi;
- `.env`, lockfile, dan `node_modules` tidak dipindai.

Hasil penting Express:

- framework `express`;

Expected React fixture:

- framework `react`;
- project type `web-app`;
- entry point `src/main.tsx`;
- tidak menghasilkan route palsu hanya karena memakai React;
- package dengan React peer dependency saja tetap `unknown`.
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
pnpm --filter @flaid/devmap test:unit
pnpm --filter @flaid/devmap test:types
```

Hasil minimum saat ini:

```text
tests 122
pass 122
fail 0
```

### Menjalankan Test Tertentu

Analyzer dan snapshot:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/analyzers.test.ts
```

Expected tambahan:

- `.agent/` dan `.agents/` tidak masuk hasil scan;
- `.agents/skills/*/SKILL.md` tidak terdeteksi sebagai fitur AI project;
- snapshot tetap hanya merepresentasikan source project yang dianalisis;
- `fileIndex[*].topFunctions` berisi fungsi atau symbol kode penting dengan
  line number, status export, dan status async;
- `flows` mencakup feature flow dan request/API flow dari route ke dependency
  lokalnya;
- `features[*].entryPoint` dan `features[*].businessFlow` terisi ketika bisa
  diinfer dari route/dependency;
- `onboarding.recommendedPath` dan `changeImpact` tersedia sebagai metadata
  navigasi lanjutan;
- `agentInstructions` tersedia di snapshot sebagai policy machine-readable
  ringkas.

AI client:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/ai-client.test.ts
```

Command `ask`:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/ask-command.test.ts
```

AI analyze:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/analyze-ai.test.ts
```

Doctor:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/doctor.test.ts
```

Terminal Markdown:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/markdown-terminal.test.ts
```

Context Builder benchmark:

```powershell
pnpm --filter @flaid/devmap exec tsx --test test/context-builder-eval.test.ts
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
node packages/cli/dist/index.js flow
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
pnpm --filter @flaid/devmap pack --pack-destination artifacts
```

Tarball akan dibuat di:

```text
artifacts/flaid-devmap-0.1.0.tgz
```

Simpan path absolutnya:

```powershell
$tarball = (Resolve-Path ".\artifacts\flaid-devmap-0.1.0.tgz").Path
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
npx @flaid/devmap --version
npx @flaid/devmap --help
```

### D. Integrasikan DevMap Ke Project

Untuk AI live, set API key hanya pada terminal aktif:

```powershell
$env:GROQ_API_KEY="gsk_your_key"
```

Jalankan:

```powershell
npx @flaid/devmap init
npx @flaid/devmap analyze --fresh
npx @flaid/devmap doctor
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
pnpm --filter @flaid/devmap pack --pack-destination artifacts

cd "C:\path\to\project-lain"
npm install --save-dev "C:\path\to\devmap\artifacts\flaid-devmap-0.1.0.tgz"
```

Kemudian jalankan kembali:

```powershell
npx @flaid/devmap analyze --fresh
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

Tes ini memastikan gaya penggunaan seperti `npx @flaid/devmap` bekerja.

Dari root DevMap:

```powershell
$tarball = (Resolve-Path ".\artifacts\flaid-devmap-0.1.0.tgz").Path
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
pnpm --filter @flaid/devmap exec tsx --test test/init-and-errors.test.ts
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

Verifikasi Node.js 22 dan 24:

```powershell
npx -p node@22 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
npx -p node@24 node packages\cli\node_modules\tsx\dist\cli.mjs packages\cli\test\run-tests.ts
```

GitHub Actions menguji:

- Windows, Ubuntu, dan macOS;
- Node.js 22 dan 24;
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
- Astro dependency tetap berada di versi yang kompatibel dengan Node 22
  (`astro@5.7.14` saat ini);
- folder placeholder di `apps/web/src/` tetap berisi README supaya struktur
  kosong landing page terdokumentasi.

Preview:

```powershell
pnpm preview:web
```

### Landing Page Redesign â€” Spec 03

Verifikasi landing page editorial calm (branch `landing-page`):

```powershell
pnpm build:web
pnpm dev:web
```

Expected:

- `astro check` menghasilkan 0 error, 0 warning, dan 0 hint;
- `astro build` sukses tanpa broken asset (logo `logo-devmap.png` belum ada,
  jadi hanya `<img>` dengan `alt=""` di header/footer dan tidak break build);
- screenshot di 375px dan 1440px untuk semua section, bukan hanya Hero
  (Edge headless):
  ```powershell
  & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --screenshot="C:\Users\Hype G12\AppData\Local\Temp\opencode\hero-375.png" --window-size=375,1400 http://localhost:4321
  ```
- tidak ada horizontal scrollbar di 375px, index list Hero tidak wrap aneh
  dan garis vertikal tetap sejajar dengan dots;
- tidak ada em dash (`â€”`) di `apps/web/src`:
  ```powershell
  (Select-String -Path "apps\web\src\**\*" -Pattern "â€”" -Recurse).Count
  ```
- `devmap ask` tidak muncul di `apps/web/src`;
- `coming soon` / `phase 2` tidak muncul di FeaturesSection dan
  OnboardingSection;
- `:focus-visible` outline aqua muncul saat tab navigation header + kedua
  tombol CTA (tidak ke-override);
- `prefers-reduced-motion: reduce` menghapus stagger animasi Hero, konten
  tetap fully visible.

### Docs Page â€” Spec 04

Build + serve:

```powershell
pnpm build:web
pnpm dev:web
```

Expected (automated/static):

- `astro check` menghasilkan 0 error, 0 warning, 0 hint;
- `astro build` membuat 2 route: `/index.html` dan `/docs/index.html`;
- `/docs` mengembalikan 200 dan berisi sidebar `.docs-sidebar` + konten
  `#quick-start`;
- sidebar memuat 8 top-level sections (Quick Start, 1-7) + 6 sub-item
  command di bawah "4. Command reference";
- fenced code block dirender via Shiki (`pre.astro-code github-dark`)
  tapi warna token di-override ke off-white oleh `docs-prose.css`
  (`.astro-code, .astro-code span { color: var(--color-text) !important;
  background: transparent !important; }`);
- header punya link `Docs` (href `/docs`) dan hamburger
  (`.site-header__toggle`, `aria-expanded`, `aria-controls`);
- CSS mobile TOC ada: `max-height: 60vh`, sticky `top: 4rem`, chevron
  rotate `details[open]`.

Expected (manual/visual, belum bisa dilakukan agent tanpa browser tool):

- screenshot `/docs` 1440px dan 375px;
- active sidebar link ikut berubah saat scroll (IntersectionObserver);
- <760px: sidebar jadi `<details>` collapsed, konten full-width;
- <760px: hamburger membuka dropdown 6 link, ikon jadi X, `aria-expanded`
  flip, klik link menutup, Escape menutup;
- <760px di `/docs`: bar "Contents" tetap sticky saat scroll, list scroll
  internal, klik link menutup panel;
- `prefers-reduced-motion: reduce` skip transisi hamburger dan TOC
  (DevTools emulation);
- scroll anchor tidak tertutup header (h2/h3 `scroll-margin-top`).

Screenshot Edge headless (1440px):

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --screenshot="C:\Users\Hype G12\AppData\Local\Temp\opencode\docs-1440.png" --window-size=1440,1000 http://localhost:4321/docs
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


---

## 12. Rilis Paket ke npm

Alur final publish `@flaid/devmap` (terverifikasi 2026-08-23 untuk versi
0.2.0).

Prasyarat sekali setup:

- Org npm `flaid` ada; akun `fadilz` sebagai owner;
- Akun punya 2FA aktif (Security Key/passkey);
- Preferensi write-actions bebas (`auth-only` cukup, publish lewat token).

Langkah rilis:

1. Pastikan working tree bersih dan gates hijau:

   ```powershell
   git status --short
   pnpm run test:unit          # dari packages/cli
   pnpm run test:types
   pnpm run test:package-e2e   # dari root
   ```

2. Buat Granular Access Token sekali pakai di
   <https://www.npmjs.com/settings/fadilz/tokens/create>: scope `@flaid`
   permission **Read and write** + opsi **bypass two-factor authentication**
   aktif, lalu Generate.

3. Pasang token sementara:

   ```powershell
   Set-Content "$env:USERPROFILE\.npmrc" "//registry.npmjs.org/:_authToken=<TOKEN>" -Encoding ASCII
   ```

4. Publish dari `packages/cli`:

   ```powershell
   cd packages\cli
   pnpm publish --access public
   ```

5. Bersihkan token dari mesin DAN revoke di website (Access Tokens):

   ```powershell
   Remove-Item "$env:USERPROFILE\.npmrc"
   ```

6. Verifikasi (registry API bisa lag beberapa menit; halaman web package
   biasanya tampil lebih dulu):

   ```powershell
   npm view @flaid/devmap version         # harus sama dengan package.json
   npx -y @flaid/devmap@latest --version  # dari folder kosong
   ```

7. Tag dan GitHub Release agar link CHANGELOG tidak 404:

   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "..." --notes "..."
   ```

Catatan: mulai Januari 2027 npm membatasi direct publishing via token bypass
2FA - pertimbangkan trusted publishing (OIDC) sebelum tanggal tersebut.
