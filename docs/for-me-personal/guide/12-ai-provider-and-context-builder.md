# 12. AI Provider & Context Builder

**Source:** `packages/cli/src/ai/`

Ada tiga hal yang hidup di folder ini: berbicara ke Groq/OpenRouter secara andal
di atas jaringan yang tidak stabil, menentukan *file mana* yang relevan dengan
pertanyaan berbahasa alami, dan menggunakan keduanya bersama untuk menggerakkan
`devmap explain`.

## `AiClient` — satu interface, dua implementasi

```ts
export interface AiClient {
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
  stream?(request: AiCompletionRequest, onDelta: AiDeltaHandler): Promise<AiCompletionResult>;
}
```

`GroqClient` dan `OpenRouterClient` keduanya mengimplementasi interface ini. `provider.ts`'s
`createAiClient(config)` adalah satu-satunya tempat yang memilih di antara mereka — semua
modul AI lainnya (`domainInference.ts`, `snapshotEnrichment.ts`,
`commands/explain.ts`) ditulis berdasarkan `AiClient` dan tidak pernah mengimpor
class konkret mana pun. Mengganti provider tidak pernah mengubah call site.

### `resolveAiRouting()` — di mana "auto" di-resolve ke model nyata

```ts
export function resolveAiRouting(config: DevmapConfig, task: AiTask) {
  if (config.model !== "auto") return { model: config.model, fallbackModels: [] };
  if (config.provider === "openrouter") return { model: OPENROUTER_FREE_MODEL, fallbackModels: [] };
  return { model: DEFAULT_AI_MODELS[task], fallbackModels: DEFAULT_AI_FALLBACKS[task] };
}
```

Hanya Groq yang mendapatkan fallback *chain* per task (`analyze`/`flowNarration`/
`explain`, masing-masing dengan primary + fallback sendiri — lihat di bawah).
Path `"auto"` OpenRouter di-resolve ke satu model gratis tanpa chain —
saat ini belum ada daftar fallback terkurasi yang setara untuk OpenRouter.

## `GroqClient` — yang lebih defensif dari keduanya

Groq mendapatkan kode resilience yang jauh lebih banyak dibanding OpenRouter, dengan
alasan konkret: katalog model yang di-host Groq berubah seiring waktu (model di-
deprecated/di-nonaktifkan), jadi client harus bertahan dari transient failure
*maupun* model yang dikonfigurasi sudah tidak ada lagi.

**Model chain, bukan sekadar retry.** `resolveModelChain()` membangun daftar yang
terurut dan deduplicated — `[request.model, ...fallbackModels, ...legacy
fallbackModel]` — dan `complete()`/`stream()` menelusurinya secara berurutan, berhenti di
hasil pertama yang berhasil:

```ts
for (const model of resolveModelChain(request)) {
  const result = await this.requestModel(request, model);
  if (result.ok) return result.result;
  lastError = result.error;
  if (!result.canFallback) throw result.error;
}
```

**`shouldTryFallback()` memutuskan kegagalan mana yang layak mengorbankan fallback
model:**

```ts
return status === 429
  || status >= 500
  || status === 404
  || (status === 400 && /model|decommissioned|not available|not found|permission/i.test(message));
```

Rate limit dan server error selalu lanjut ke model berikutnya. 400
hanya memicu fallback jika *teks pesan* itu sendiri menunjukkan masalah
model — invalid-key atau malformed-request 400 seharusnya tidak menghabiskan
semua fallback model hanya untuk gagal dengan cara yang sama di masing-masing;
kesalahan seperti itu langsung throw (`canFallback: false`).

**Exponential backoff khusus untuk 429**, terpisah dari
model-fallback chain:

```ts
const delay = Math.min(readRetryDelay(response) * (2 ** retryAttempt), MAX_RATE_LIMIT_DELAY_MS);
```

Maksimal 3 retry *di model yang sama* sebelum model tersebut dianggap
habis dan chain lanjut ke berikutnya. `readRetryDelay()` menghormati
header `retry-after` dari server jika ada, dengan fallback ke basis 1 detik.

**`EXCLUDED_MODEL_PATTERNS`** — saat mencantumkan model yang tersedia (digunakan oleh
model picker interaktif di `devmap init`/`devmap config model`, ch.
commands 1/7), sepuluh regex memfilter apa pun yang bukan model
chat biasa: Whisper (speech-to-text), classifier prompt-guard/safety, model
orchestration `compound-beta`, TTS, model vision-only dan LLaVA,
embedding, variant speculative-decoding, dan reranker. Tanpa filter
ini, picker akan mencantumkan model yang mengembalikan HTTP error begitu
kamu mengirim request chat completion normal ke mereka. `PREFERRED_MODELS` lalu
menyortir tiga model yang sudah diketahui bagus ke atas dari sisanya.

## `OpenRouterClient` — lebih sederhana, secara desain

Tidak ada retry/backoff loop, tidak ada filtering pengecualian model, tidak ada daftar fallback
terkurasi — routing dari OpenRouter sendiri (`models: [...]` array di request
body, digunakan saat `resolveModels()` menghasilkan lebih dari satu kandidat) diizinkan
untuk melakukan pekerjaan itu sendiri daripada DevMap mengimplementasi ulang
di sisi client. Kedua client secara sengaja tidak simetrik; kode tambahan Groq
ada karena Groq secara khusus membutuhkannya, bukan karena inkonsistensi
yang perlu diperbaiki.

## Streaming: di-parse dua kali, hampir identik

Kedua client mengimplementasi parsing SSE stream — menampung chunk yang masuk, memecah
event berdasarkan pemisah baris kosong, mengekstrak baris `data:`, mengakumulasi konten
`delta` sambil meneruskannya secara live via `onDelta`, berhenti di sentinel literal `[DONE]`.
Ini benar-benar diduplikasi (tidak dibagikan via helper bersama) karena bentuk payload
kedua provider cukup berbeda (`payload.usage` vs. `payload.usage ?? payload.x_groq?.usage` dari Groq)
sehingga implementasi bersama tetap membutuhkan hook spesifik provider.
`completion.ts`'s `completeWithOptionalStreaming()` adalah satu-satunya tempat yang
tidak peduli client mana yang dipegang — ia memeriksa `client.stream`
apakah ada sebelum memutuskan apakah akan streaming, dan merender apa pun
yang datang via `output.markdownStream()`.

## Prompt: tiga call site, satu disiplin bersama

**Source:** `prompts.ts`

`buildAnalyzeMessages`, `buildFlowNarrationMessages`, dan
`buildExplainMessages` masing-masing membangun pasangan pesan `system` + `user`.
Ketiga system prompt tersebut mengulang constraint yang sama dengan kata-kata
berbeda — *"hanya nyatakan kembali apa yang ada di data yang diberikan, jangan mengarang
module/file/behavior."* Ini mencerminkan disiplin prompt domain-inference di ch. 11: di setiap
panggilan AI dalam codebase, model secara eksplisit dibatasi untuk menjelaskan
faktor static-analysis, bukan untuk bernalar bebas tentang
codebase dari pengetahuan umum. `buildExplainMessages` secara khusus
mengirim *konten file nyata* (`context.files[].content`, dibatasi oleh
`contextBuilder.ts`) — satu-satunya panggilan AI dalam sistem yang melakukan ini, tidak seperti
pendekatan metadata-only domain inference (ch. 11) — karena menjelaskan
perilaku file tertentu secara jelas membutuhkan pembacaan file tersebut.

## Context builder — retrieval untuk `devmap explain`

**Source:** `contextBuilder.ts` (~925 baris, file terbesar kedua di
`src/`)

`buildQuestionContext()` mengubah pertanyaan teks bebas menjadi set potongan file
yang sudah diurutkan dan dibatasi ukuran untuk diberikan ke model. Ini adalah pipeline
informasi-retrieval mini milik file itu sendiri: tokenize → klasifikasi intent →
rank setiap file dalam snapshot → perluas via tetangga graph → potong.

### Bilingual sejak awal

`STOP_WORDS` dan `CONCEPT_ALIASES` dengan sengaja mencampur bahasa Inggris dan Indonesia
— bukan sebagai tambahan belakangan:

```ts
const STOP_WORDS = new Set(["about", "adalah", "apa", "bagaimana", "bekerja",
  "dalam", "dimana", "dengan", "mana", "untuk", "where", "yang", /* ...more... */]);

const CONCEPT_ALIASES = {
  auth: ["auth", "authentication", "autentikasi", "login", "session", "sesi", "nextauth"],
  payment: ["payment", "payments", "pembayaran", "stripe", "midtrans", "checkout"],
  upload: ["upload", "unggah", "file", "multer", "cloudinary"],
  // ...
};
```

`RUNTIME_DATA_QUERY_TERMS` bahkan memasukkan `"koneksi"` (Indonesia untuk
"connection") bersama `"connect"`/`"connection"`/`"init"`. Pertanyaan
yang ditanyakan sepenuhnya dalam Bahasa Indonesia (`"gimana cara kerja autentikasi di project
ini?"`) tetap di-tokenize dan di-skor secara bermakna, bukan hanya pertanyaan dalam bahasa Inggris.

### Klasifikasi intent menentukan budget file/baris, bukan sekadar label

```ts
const INTENT_TERMS = {
  add_feature: ["add", "build", "create", "implement", "make", "support"],
  change: ["change", "modify", "refactor", "update"],
  debug: ["bug", "debug", "error", "fail", "fails", "fix", "issue", "wrong"],
  explain: ["explain", "how", "what", "why"],
  navigate: ["find", "start", "where"]
};
```

Intent yang terdeteksi memilih di antara tiga tier budget —
`DEFAULT_MAX_FILES = 5` / `200` baris masing-masing untuk pertanyaan umum,
`NAVIGATION_MAX_FILES = 2` / `60` baris untuk pertanyaan "di mana saya mulai",
dan yang sama ketatnya `2` / `60` untuk intent `add_feature`/`change`
(`usesFocusedContext()`). Alasannya: pertanyaan debugging atau penjelasan
lebih diuntungkan dari cakupan luas (lebih banyak file, lebih banyak konten per file), sementara
pertanyaan "di mana saya harus menambahkan X" atau "di mana Y" lebih diuntungkan dari jawaban
yang kecil dan presisi — menumpuk 5 file masing-masing 200 baris justru akan mengubur
satu titik masuk relevan yang sebenarnya dibutuhkan orang tersebut.

### Skoring: banyak sinyal kecil, dijumlahkan

`rankContextFiles()` menghitung satu skor per file dengan menjumlahkan sekitar delapan
sinyal independen, masing-masing menyumbang string kecil `reasons[]` sehingga
skor file bisa dijelaskan, bukan kotak hitam:

| Sinyal | Bobot (keyword match langsung) | Bobot (istilah expanded/alias) |
|---|---|---|
| Path term match (word-boundary) | 30 | 14 |
| Path substring | 6 | 4 |
| Export/symbol term match | 26 | 12 |
| Export substring | 8 | 4 |
| Import/dependency match | 3 | 2 |
| Snapshot `searchTerms` match | 30 | — |
| Feature evidence (file merupakan evidence untuk feature yang match) | 10–30 | — |
| Route evidence (file menangani route yang match) | 30 | — |
| Entry-point match (hanya untuk query bertipe entry-point) | 40 | — |

Keyword match langsung di-weight sekitar 2x lipat dari alias-expanded
counterpart-nya — istilah alias-expanded (misalnya `"autentikasi"`
yang match karena pertanyaan menyebut `"auth"`) dianggap sebagai bukti nyata tetapi
sedikit lebih lemah dibanding istilah literal yang diekstrak dari
pertanyaan itu sendiri. `STRUCTURAL_NAVIGATION_FEATURES` (`"CLI Commands"`,
`"Documentation"`, `"Web Landing"`, dll. — feature berbasis peran ch. 6)
secara eksplisit dikecualikan dari skoring feature-evidence *kecuali*
keyword pertanyaan itu sendiri secara langsung menyebutnya — kalau tidak, hampir semua file
dalam proyek CLI akan mendapat boost "evidence for CLI Commands" baseline
terlepas dari apa yang sebenarnya ditanyakan.

Dua bonus kecil hanya berlaku untuk file yang sudah mendapat skor **di atas nol**
dari term match aktual — keanggotaan `criticalFiles` dan snapshot
`importance` keduanya menambahkan bonus yang dibatasi (≤15, ≤10) di atasnya, tetapi tidak pernah cukup
sendirian untuk menampilkan file dengan relevansi nol nyata.

### Graph expansion — satu hop lagi, dengan diskon

`expandGraphNeighbors()` hanya dijalankan saat profil query memintanya
(`includeRelatedFiles`, pada dasarnya "bukan query navigation/intent-fokus")
— untuk masing-masing dari file langsung yang match paling atas, baik import-nya maupun
apa pun yang mengimport *file tersebut* ditambahkan sebagai related file, di-skor sekitar 1/4 hingga
1/5 dari skor match asalnya (`Math.floor(match.score / 4)`, floor
`MIN_RELEVANCE_SCORE = 25`). Ini hanya satu hop, bukan ekspansi
rekursif — file yang tiga import jauh dari match langsung tidak akan masuk
peringkat.

### Confidence dan perakitan akhir

`getRelevanceConfidence(topScore)` mengelompokkan skor file teratas ke dalam
`high` (≥70) / `medium` (≥40) / `low` — ini adalah confidence yang
`commands/explain.ts` (ch. commands 6) periksa sebelum memutuskan apakah akan
menjawab langsung atau memberi tahu pengguna bahwa ia tidak yakin telah menemukan file
yang tepat. Konten file itu sendiri dibaca ulang dari disk (`readFile`, `realpath`
untuk menjaga dari symlink escape di luar `projectRoot`) dan dipotong ke
budget baris yang sesuai dengan intent saat perakitan — langkah peringkat
itu sendiri tidak pernah menyentuh konten file, hanya metadata `fileIndex`, jadi scoring
5.000 file tetap murah terlepas dari seberapa besar masing-masing file.

## Snapshot enrichment — satu pass AI lainnya, dan mengapa terpisah dari domain inference

**Source:** `snapshotEnrichment.ts`

Ini dijalankan (juga opsional, juga gracefully-degrading) selama
`devmap analyze` untuk meningkatkan field `purpose`/`searchTerms` dari
default statis yang di-auto-generate menjadi yang ditulis AI, lebih spesifik — untuk
**file**, di-batch 20 sekaligus (`FILE_BATCH_SIZE`) agar setiap request
tetap kecil, dan secara terpisah untuk **features**, satu request mencakup
semuanya. Ini adalah concern yang berbeda dari domain inference ch. 11: domain
inference *menambahkan feature baru* dengan bernalar tentang keseluruhan proyek;
enrichment hanya *memperbaiki wording field yang sudah ada* yang sudah diisi
oleh pipeline statis, dan hanya untuk file yang lolos ambang kelayakan
(`selectEligibleFiles`) — file kritis, `importance >= 20`, file dengan
referensi feature, atau file yang match `isSemanticEnrichmentCandidate()` (regex
yang lebih sempit dan spesifik untuk file bertipe auth/session,
independen dari `detectAuthenticationSemanticRole` ch. 6 —
ini adalah contoh lain dari konsep yang diimplementasi lebih dari sekali di
codebase, kali ini secara sengaja: kelayakan enrichment adalah pemeriksaan yang lebih murah
dan lebih sempit dibanding classifier semantic-role penuh karena ia hanya perlu
memutuskan "apakah ini layak ditulis ulang oleh AI," bukan mengklasifikasi peran).

Setiap nilai yang ditulis AI tetap melewati normalisasi yang sama dengan yang
diterapkan oleh pipeline statis — `normalizeSearchTerms()` menolak istilah vagu
(`"data"`, `"logic"`, `"handler"`, ...) melalui jenis blocklist istilah vagu yang sama
yang digunakan `contextBuilder.ts`'s `VAGUE_EXPANSION_TERMS` untuk tujuan terkait —
AI diperbolehkan memperbaiki kata-kata, tetapi tidak pernah diperkenankan
memperkenalkan kembali pengisi generik yang memang dirancang untuk dihindari oleh
pipeline statis sejak awal.

## Lihat juga

- Ch. 11 untuk pass AI saudaranya (domain inference) dan mengapa disiplin
  prompt-nya mencerminkan ch. ini
- Ch. 6 untuk `detectAuthenticationSemanticRole`, kerabat dari
  `isSemanticEnrichmentCandidate`
- Commands ch. 6 untuk bagaimana `devmap explain` mengonsumsi `QuestionContext`
  end to end
- Ch. 14 untuk `DevmapConfig`, input ke `createAiClient`/
  `resolveAiRouting`
