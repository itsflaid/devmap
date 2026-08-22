# Index — isi dari setiap file

`README.md` adalah pintu masuk (filosofi, urutan baca, tautan cepat).
File ini adalah tabel referensi: satu paragraf nyata per file `.md` di folder
ini, jadi kamu bisa menemukan bab yang tepat tanpa harus membuka lima file
dulu.

---

## Bab sistem (`guide/`)

### `01-pipeline-orchestration.md`
Membahas `analyzers/pipeline/projectMap.ts` — fungsi `createProjectMap()`
yang pada akhirnya dipanggil oleh setiap perintah. Menjelaskan kenapa `callAI` adalah
parameter opsional (dan apa implikasinya terhadap static analysis yang tidak
pernah bergantung pada AI), menelusuri urutan panggilan lengkap dari `scanFiles` sampai
generasi flow, dan membahas `createProjectFingerprint()`, mekanisme deterministik
berbasis MD5 yang bergantung padanya sisa CLI untuk mendeteksi "tidak ada
perubahan." Menandai bahwa **ada dua sistem scoring terpisah**
(`rankCriticalFiles` vs. `calculateImportance`) yang keduanya mengonsultasikan signal
semantic-role autentikasi yang sama tetapi memberi bobot sangat berbeda — baca
ini sebelum menyentuh salah satunya.

### `02-scanning-and-analysis.md`
Membahas `fileScanner.ts`, `filterEngine.ts`, dan `AnalyzerRegistry`
cascade di `analysis/`. Menjelaskan kenapa urutan scan file harus
deterministik, sistem ignore empat lapis (folder hardcoded,
lockfile hardcoded, pola path, dan `.gitignore` proyek sendiri),
dan fallback analyzer tiga tier (`TsMorphAnalyzer` →
`HeuristicAnalyzer` → `FallbackAnalyzer`) — termasuk bagaimana file `.vue`/
`.svelte`/`.astro` mengekstrak script yang terembed sebelum
`ts-morph` melihatnya. Juga memperkenalkan `FileRole`, classifier per-file
independen kedua (test/config/api-handler/service/...) yang sangat
bergantung padanya deteksi fitur nanti.

### `03-framework-and-route-detection.md`
Membahas `frameworkDetector.ts`, `routeDetector.ts`, `nestRouteDetector.ts`,
`databaseDetector.ts`, dan `serviceDetector.ts`. Menjelaskan
`isArchitectureSource()` sebagai penjaga bersama (kenapa folder `examples/` tidak bisa
membingungkan deteksi framework), strategi deteksi dua fase dependency-first/
file-structure-second yang bisa mengembalikan framework frontend
*maupun* backend dari satu scan monorepo, dan ekstraksi route per-framework
untuk ketujuh framework yang didukung — termasuk bagaimana router mount
Express/Fastify diresolusi melalui graf dependency, dan kenapa
NestJS adalah satu-satunya detector yang dibangun di atas AST nyata alih-alih regex.

### `04-entity-extraction.md`
Membahas `analysis/extractors/` — rantai fallback Prisma → SQL → route-hint yang
menghasilkan `EntityInfo`/`EntityGraph`. Menjelaskan bagaimana arah relasi Prisma
*diinfer* alih-alih dibaca langsung, kenapa nama tabel SQL
diambil dari string literal AST alih-alih regex pencocokan quote
(dan filter stopword/title-case yang diperlukan untuk menghindari
false positive dari UI biasa), dan helper `singularize()` yang dibagikan
dengan penamaan route-hint. Menandai bahwa relasi per-entity dan
hubungan graf entity tingkat atas dihitung oleh **dua fungsi terpisah**,
bukan satu.

### `05-signal-registry.md`
Membahas `analyzers/registry/` — sistem `SignalDescriptor` terpusat yang
mendukung signal fitur, deteksi external-service, *dan*
deteksi AI-provider dari satu daftar bersama. Menjelaskan flag `importOnly`
(sebutan proso tidak boleh dihitung, hanya impor nyata) dan
`minimumDistinctFiles` (bukti single-match terlalu lemah untuk beberapa
signal), lalu menelusuri `FEATURE_SIGNALS`/`SERVICES`/
`SOURCE_SERVICE_SIGNALS` sebagai tiga tampilan turunan dari satu daftar datar.
Bab paling singkat secara sengaja — sekaligus berfungsi sebagai tutorial
"cara menambahkan signal provider baru."

### `06-feature-detection-engine.md`
Membahas `featureDetector.ts`, file terbesar dan paling banyak dirujuk di
kode sumber. Menelusuri keempat sumber bukti yang memberi makan `detectFeatures()`
(berbasis file-role, berbasis registry-keyword, berbasis capability,
berbasis entity), model ownership yang memutuskan apakah sebuah entity
menjadi fitur tersendiri atau digabung ke dalam tujuan parent sebagai
"anak benar," helper tiering file dan entry-point-scoring yang digunakan oleh setiap
sumber bukti, dan subsistem semantic-role autentikasi — potongan
logika yang paling banyak dirujuk silang di seluruh panduan.

### `07-capability-detection.md`
Membahas `capabilityDetector.ts`. Menjelaskan dua pass deteksi (CRUD
dikelompokkan berdasarkan URL resource, dan sepuluh signal perilaku yang di-tuning manual
seperti sharing/collaboration/real-time), dan membahas mendalam sejarah
desain sebenarnya di balik kenapa confidence threshold di-tuning per-signal — sebuah
rute `/search` tunggal pernah memicu false positive "high confidence" fitur
pencarian, dan perbaikannya (hanya API-routes, per-signal `minimumMatches`)
dijelaskan dengan penalaran utuh. Menandai adanya `singularize()` kedua yang
independen dan diam-diam berbeda dari yang di bab 4.

### `08-similarity-and-merge.md`
Membahas `featureSimilarity.ts`/`featureMerge.ts` — mesin tunggal yang dilalui
setiap keputusan merge fitur di kode sumber (berbasis role, berbasis
signal, berbasis capability, berbasis entity, *dan* yang di-infer oleh AI). Menjelaskan empat faktor similarity berbobot (tumpang tindih Jaccard
file/term/entity ditambah similarity nama trigram), kenapa aturan merge
"nama yang pertama kali ditemui menang," dan tabel merge field-per-field
(kenapa `purpose` kadang ditimpa dan `confidence` tidak pernah turun). Juga mencatat
fungsi fingerprinting yang belum digunakan yang disimpan untuk lapisan persistensi
lintas-run di masa depan.

### `09-dependency-graph-and-flows.md`
Membahas `analyzers/graph/` ditambah setengah bagian generasi flow dari
`projectMap.ts`. Menjelaskan bagaimana graf impor file-to-file dibangun dan
diresolusi, deteksi entry-point, dan tree walk terbatas yang aman-cycle dan
fan-out-capped yang dirender langsung oleh `devmap map`. Juga membahas dua
generator flow di balik `devmap flow` (`generateFeatureFlows`, berbasis narasi;
`generateRequestFlows`, berbasis graph-BFS) dan menandai helper dependensi-balik
kedua yang diimplementasi secara independen hanya digunakan untuk
analisis dampak perubahan.

### `10-frontend-page-features.md`
Membahas `frontendFeatureDetector.ts`. Menjelaskan bug nyata yang module ini
ada untuk mencegah (proyek yang punya satu tabel database sekalipun tidak akan pernah
menjangkau tier fallback route-hint, jadi fitur halaman pure frontend-only tidak akan
muncul), lima pola regex yang digunakan untuk mendeteksi
client-side route di React Router/Vue Router/svelte-spa-router, dan
aturan "ownership" — sebuah file hanya menjadi bagian dari fitur jika *setiap* file
yang mengimpornya juga berada di dalam batas fitur tersebut.

### `11-ai-domain-inference.md`
Membahas `analyzers/inference/` — satu-satunya langkah pipeline yang menyentuh
jaringan. Bab andalan "kenapa AI perlu landasan struktural":
menjelaskan kenapa nama entity saja (`Message`, `Room`) tidak bisa membedakan
aplikasi chat dari aplikasi catatan pribadi, bagaimana `classifyOwnershipTopology()`
menyediakan bukti struktural yang sebenarnya bisa, instruksi eksplisit prompt untuk
mempercayai bukti itu di atas penamaan, caching SHA-256 untuk
stabilitas antar-run, dan kenapa setiap kegagalan degradasi ke `null` alih-alih
melempar error.

### `12-ai-provider-and-context-builder.md`
Membahas `ai/` secara lengkap — `GroqClient`/`OpenRouterClient`, template prompt,
dan mesin retrieval ~925 baris di balik `devmap explain`. Menjelaskan
rantai model-fallback Groq dan penanganan 429/5xx/model-decommissioned
(dan kenapa client OpenRouter sengaja lebih sederhana), sistem
keyword/stop-word/concept-alias bilingual (Inggris + Indonesia) di dalam
`contextBuilder.ts`, bagaimana intent pertanyaan yang terdeteksi memilih budget file/baris,
dan pass AI snapshot-enrichment terpisah yang mereword
field yang sudah ada alih-alih menginfer yang baru.

### `13-agent-navigation-output.md`
Membahas `cache/agentNavigation.ts` — apa yang sebenarnya ditulis ke
`.devmap/index.json` dan `.devmap/features/*.json`, file yang DevMap
perintahkan agar dibaca duluan oleh AI coding agent. Menjelaskan rumus scoring
`selectIndexCriticalFiles` (entry-point rank, bonus CLI-command, penurunan BFS distance-to-
entry, bobot kepemilikan flow/fitur) dan menandai adanya tabrakan nama field yang sama
antara dua konsep yang berhubungan tapi berbeda yang tidak boleh dicampuradukkan.

### `14-snapshot-cache-and-config.md`
Membahas `cache/fileHash.ts`, `cache/snapshot.ts`, dan `utils/config.ts`.
Menjelaskan kenapa MD5 (`hashContent`) dan SHA-256 (cache domain-inference
bab 11) adalah dua mekanisme hashing yang sengaja terpisah alih-alih satu
utilitas bersama, versioning skema snapshot dan migration shim yang
menormalkan bentuk snapshot lama saat dibaca, dan pemisahan config
global-vs-project-local — termasuk kenapa `apiKey`/`provider` diabaikan secara diam-diam
jika seseorang menempatkannya di file yang salah.

### `15-onboarding-system.md`
Membahas `onboarding/model.ts` + `modelBuilder.ts` — logika murni, tanpa AI
untuk generasi narasi di balik `devmap onboarding` (perintahnya sendiri
dokumentasi terpisah, lihat di bawah). Menjelaskan empat template cerita
"bagaimana cara kerjanya" bercabang yang dicocokkan dengan bentuk proyek, safeguard
independen kedua terhadap salah baca `Message`/`Room` yang sama seperti bab 11
tangani di level AI-prompt — yang ini diterapkan pada narasi untuk manusia
alih-alih — dan menandai ini sebagai **peringkat ketiga** independen "apa yang
dibaca duluan" di kode sumber, bersama bab 1 dan bab 13.

---

## Dokumentasi perintah (`guide/commands/`)

### `01-init.md`
Membahas `commands/init.ts`. Menjelaskan pola dependency injection
yang diikuti setiap perintah di CLI, bagaimana provider/API-key/model masing-masing
diresolusi melalui rantai prioritasnya sendiri dengan fallback non-interactive,
dan kenapa `AGENTS.md` yang sudah ada tidak pernah ditimpa secara diam-diam.

### `02-analyze.md`
Membahas `commands/analyze.ts` — satu-satunya tempat `createProjectMap()`
benar-benar dipanggil dan dipersist. Menjelaskan jalur cepat berbasis fingerprint
(dan detail yang mudah terlewat bahwa file agent-navigation tetap
ditulis ulang meskipun ada cache hit), tiga cache terkait AI terpisah yang
aktif selama satu run, dan kenapa `DevmapError` degradasi secara graceful
sementara error lain yang dilempar dibiarkan crash perintah.

### `03-onboarding.md`
Membahas `commands/onboarding.ts` — lapisan rendering Markdown dan CLI
di atas logika pembuatan model bab 15. Menjelaskan resolusi bahasa
(flag eksplisit → prompt interaktif → default bahasa Inggris yang sunyi),
struktur Markdown enam bagian, dan daftar `AVAILABLE_COMMANDS` hardcoded
yang harus diperbarui secara manual setiap kali perintah CLI baru
rilis atau ia akan diam-diam menghilang dari footer panduan.

### `04-map.md`
Membahas `commands/map.ts` — tiga jalur rendering yang benar-benar berbeda
(file, fitur, proyek) yang dipilih berdasarkan apa yang diresolusi oleh target. Menjelaskan
kedalaman tree "uses" vs. "used by" yang sengaja asimetris, bagaimana mode fitur
membandingkan tree walk internal dengan set file lengkap untuk menghitung
dependensi/dependen eksternal, dan kenapa daftar edge diagram Mermaid
dibatasi untuk menyamai daftar teks (yang mungkin dipotong) secara tepat.

### `05-flow.md`
Membahas `commands/flow.ts`. Menjelaskan bahwa `--all` bukan filter tampilan
pada data yang sama — ia memicu regenerasi yang benar-benar lebih longgar
(`minConfidence: "medium"`, semua jenis rute, tanpa batas) — bagaimana resolusi
target hanya menerima otomatis kecocokan parsial yang tidak ambigu, dan bagaimana
narasi AI per-flow gagal secara independen per flow alih-alih membatalkan
seluruh perintah.

### `06-explain.md`
Membahas `commands/explain.ts`. Menjelaskan resolver target tiga arah
(fitur → file → nama fungsi, dalam urutan itu), kenapa `devmap explain`
saat ini **tidak** punya jalur pertanyaan free-text meskipun `contextBuilder.ts`
jelas dibangun untuk itu, dan kenapa ini satu-satunya perintah yang tidak punya
fallback static-only — tanpa API key berarti error yang langsung dan jelas alih-alih
hasil yang terdegradasi.

### `07-config.md`
Membahas `commands/config.ts` — saat ini hanya subperintah `config model`,
dan file terkecil di CLI. Menjelaskan titik branch `--local`
(override hanya-proyek vs. setiap proyek di mesin),
dan kenapa mengatur model ke `"auto"` adalah pilihan tersimpan yang bermakna, bukan
sama dengan tidak mengaturnya.

### `08-doctor.md`
Membahas `commands/doctor.ts`. Menjelaskan kenapa `doctor` sengaja menjalankan ulang
scan file baru dan deteksi framework sendiri alih-alih mempercayai
apa pun yang di-cache di `.devmap/snapshot.json` (sehingga snapshot yang stale menjadi
terdeteksi alih-alih dipercaya secara diam-diam), pengecekan jaringan langsung yang
memastikan API key/model yang tersimpan masih benar-benar berfungsi hari ini, dan apa
yang mengisi daftar `issues[]` akhir.