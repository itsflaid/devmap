# DevMap — Panduan Kontributor & Internals

Folder ini menjelaskan **bagaimana DevMap sebenarnya bekerja di balik layar** — mesin
analisisnya, bukan hanya permukaan CLI-nya. Dokumen ini ditulis untuk dua audiens sekaligus:
maintainer proyek yang sedang mempelajari ulang sebuah module enam minggu setelah menulisnya,
dan kontributor yang belum pernah membuka repo ini sebelumnya.

## Bedanya dengan `docs/`

Repo ini sudah punya folder `docs/` — tetap gunakan itu, panduan ini tidak
menggantikannya:

| Folder | Menjawab | Gaya |
|---|---|---|
| `docs/` | *Apa yang DevMap lakukan, sebagai produk?* | Untuk pengguna: perintah, flag, file yang dihasilkan, roadmap |
| `guide/` (folder ini) | *Bagaimana ini dibangun, dan kenapa bekerja seperti itu?* | Untuk implementasi: nama fungsi, algoritma, tradeoff desain |

Secara konkret: `docs/commands.md` memberitahumu bahwa `devmap init` meminta provider dan
menyimpan file config. `guide/commands/01-init.md` memberitahumu *fungsi mana* yang
meresolver provider, *bagaimana* API key divalidasi sebelum sesuatu ditulis ke disk,
dan *mapauna* branch interaktif-vs-JSON itu ada.

Kalau sebuah fakta sudah terdokumentasi dengan baik di `docs/`, panduan ini akan
mengarahkan ke sana alih-alih mengulanginya.

Cari tahu cakupan sebuah file tanpa membukanya?
[`index.md`](./index.md) punya satu paragraf lengkap per bab dan per
dokumentasi perintah.

## Cakupan

Semua yang ada di sini membahas `packages/cli` — mesin DevMap yang sesungguhnya dan CLI.
`apps/web` (landing page Astro) di luar cakupan; itu situs marketing,
bukan bagian dari sistem yang DevMap gunakan untuk menganalisis proyek.

## Urutan baca

15 bab bernomor mengikuti urutan data yang sebenarnya mengalir melalui
`createProjectMap()` (lihat [`01-pipeline-orchestration.md`](./01-pipeline-orchestration.md)).
Baca secara berurutan untuk pertama kali; gunakan sebagai referensi setelah itu.

### Sistemnya, bab per bab

1. [Pipeline Orchestration](./01-pipeline-orchestration.md) — `createProjectMap()`, tulang punggung 4 langkah, fingerprinting, dua sistem scoring independen
2. [Scanning & Analysis](./02-scanning-and-analysis.md) — penemuan file, aturan ignore, cascade analyzer TsMorph → Heuristic → Fallback, preprocessor
3. [Framework & Route Detection](./03-framework-and-route-detection.md) — deteksi framework berbasis dependency, ekstraksi route per-framework (7 framework), deteksi database & service
4. [Entity Extraction](./04-entity-extraction.md) — strategi extractor (Prisma → SQL → route fallback) dan graf hubungan entity
5. [Signal Registry](./05-signal-registry.md) — sistem `SignalDescriptor` terpusat untuk fitur signal, deteksi service, dan deteksi AI-provider
6. [Feature Detection Engine](./06-feature-detection-engine.md) — `detectFeatures()` dari awal sampai akhir, tiering file, dan subsistem semantic-role autentikasi
7. [Capability Detection](./07-capability-detection.md) — signal perilaku dari bentuk route, dan kenapa threshold diatur sangat konservatif
8. [Similarity & Merge](./08-similarity-and-merge.md) — mesin pencocokan Jaccard/trigram dan `mergeFeatureInto()` tunggal yang digunakan di mana pun dua daftar fitur perlu digabung
9. [Dependency Graph & Flows](./09-dependency-graph-and-flows.md) — graf impor file, deteksi entry-point, tree walk terbatas, dan generasi flow
10. [Frontend Page Features](./10-frontend-page-features.md) — mengubah halaman dan client-side route menjadi fitur untuk Next/Nuxt/SvelteKit/React Router/Vue Router
11. [AI Domain Inference](./11-ai-domain-inference.md) — heuristik ownership-topology, caching SHA-256, dan prompt safeguard terhadap false positive pada penamaan
12. [AI Provider & Context Builder](./12-ai-provider-and-context-builder.md) — client Groq/OpenRouter, retry/fallback/streaming, dan mesin retrieval di balik `devmap explain`
13. [Agent Navigation Output](./13-agent-navigation-output.md) — apa yang sebenarnya ditulis ke `.devmap/index.json` dan `.devmap/features/*.json`, serta scoring di baliknya
14. [Snapshot, Cache & Config](./14-snapshot-cache-and-config.md) — persistensi/versioning snapshot, MD5 vs SHA-256, lapisan config global vs project-local
15. [Onboarding System](./15-onboarding-system.md) — mesin narasi bilingual (EN/ID) proyek yang menggerakkan `devmap onboarding` (perintahnya sendiri didokumentasi terpisah, lihat di bawah)

### Perintah, satu file masing-masing

`guide/commands/` mencerminkan `packages/cli/src/commands/` — satu file per
perintah CLI yang terdaftar, berfokus pada implementasi (pola dependency injection,
branching JSON-mode, error handling), bukan penggunaan untuk pengguna:

- [`init`](./commands/01-init.md) · [`analyze`](./commands/02-analyze.md) · [`onboarding`](./commands/03-onboarding.md) · [`map`](./commands/04-map.md) · [`flow`](./commands/05-flow.md) · [`explain`](./commands/06-explain.md) · [`config`](./commands/07-config.md) · [`doctor`](./commands/08-doctor.md)

## Tema yang berulang

Dua ide muncul berulang kali di bab-bab ini, perlu diingat sejak awal:

- **Static analysis melakukan pekerjaan berat; AI hanyalah lapisan tipis, opsional,
  yang di-cache di atasnya.** Semua bab sampai 10 bisa jalan tanpa API key sama sekali. AI
  baru masuk di domain inference (bab 11), narasi arsitektur/flow dan
  `explain` (bab 12) — dan setiap panggilan AI degradasi secara graceful ke "skip saja"
  alih-alih gagalkan seluruh analisis.
- **Primitif yang sama digunakan ulang alih-alih diimplementasi ulang.** Detektor
  semantic-role autentikasi (bab 6) dikonsultasikan dari setidaknya
  empat fungsi scoring yang tidak berkaitan. Mesin similarity/merge (bab 8) adalah
  jalur tunggal yang dilalui oleh fitur yang di-infer oleh AI maupun yang murni statis.
  Ketika kamu membaca sebuah bab dan sebuah fungsi tampak terlalu general-purpose,
  biasanya karena bab lain juga mengandalkannya — tautan "See also"
  mengarah ke sana.

## Catatan soal bahasa

Panduan ini ditulis dalam bahasa Inggris, menyamai `README.md`, `CONTRIBUTING.md`,
dan sisa `docs/`. Komentar inline di source code aslinya merupakan campuran
bahasa Inggris dan Indonesia (`projectMap.ts` khususnya) — itu adalah
pilihan gaya di level source dan tidak mempengaruhi apa pun di sini.