# DevMap — Proposal: `fullstack` ProjectType

Status: DRAFT untuk diskusi. Belum diputuskan. Rekomendasi sementara:
skip dari fase utama `update-support-framework-detector`, kerjakan
terpisah kalau benar-benar diperlukan.

## 1. Konteks / Masalah
- `ProjectType` saat ini satu nilai:
  `"node-cli" | "web-app" | "api-service" | "library" | "unknown"`
  (didefinisikan di `packages/cli/src/analyzers/pipeline/projectMetadata.ts`).
- `detectProjectType(framework, manifests)` memilih SATU tipe per scan:
  `bin` → node-cli; framework nextjs/react/astro → web-app; express →
  api-service; `exports`/`main` → library; else unknown.
- Batasan: project yang punya frontend DAN backend sekaligus (monorepo
  `apps/web` + `apps/api`, atau satu package dengan dua dependency)
  cuma bisa dapat SATU label — "web-app" atau "api-service", tidak keduanya.
- Setelah fase 0 (multi-framework detection), `frameworks` menjadi array
  berisi maksimal 2 elemen (1 frontend + 1 backend). Ini memberi bahan
  untuk mendeteksi "keduanya" yang sebelumnya tidak ada.

## 2. Proposal
Tambah nilai `"fullstack"` ke `ProjectType`. Logika di `detectProjectType`
setelah fase 0 menggunakan Set membership `FRONTEND_FRAMEWORKS` dan
`BACKEND_FRAMEWORKS`:
- `bin` di salah satu manifest → `"node-cli"` (prioritas #1 — perlu diskusi)
- elemen dari KEDUA set sekaligus → `"fullstack"`
- hanya frontend → `"web-app"`; hanya backend → `"api-service"`
- `exports`/`main` → `"library"`; else → `"unknown"`

## 3. Dampak / Breaking change
- `ProjectType` adalah public enum pada schema snapshot. Konsumennya:
  `snapshot.json`, `index.json`, agent navigation, `devmap onboarding`,
  docs, output `--json`, template `DEVMAP.md`/`AGENTS.md`.
- Konsumen lama yang tidak mengenali nilai `"fullstack"` bisa jatuh ke
  `unknown`/default.
- `cache/snapshot.ts` (`normalizeSnapshotDefaults`) perlu update — saat ini
  default projectType cuma kenal nextjs/react → web-app, express → api-service.
- `SNAPSHOT_SCHEMA_VERSION` tetap `"1"`? Menambah nilai string tidak mengubah
  bentuk schema, tapi ada argumen untuk bump versi supaya konsumen tahu.

## 4. Pertanyaan desain (untuk diskusi)
1. Prioritas: monorepo workspace dengan CLI + web + api — `node-cli` menang
   atas `fullstack`? Atau perlu hierarki lebih eksplisit?
2. Prioritas `library`: manifest dengan `exports`/`main` + frontend+backend —
   diklasifikasi `library` atau `fullstack`?
3. Apakah cukup satu nilai enum, atau lebih baik derived field tambahan
   (misal `project.types: string[]`) supaya tidak saling meniadakan?
4. Apakah `"fullstack"` perlu nilai enum tersendiri, atau cukup helper
   `isFullstack()` yang dihitung dari `frameworks` tanpa mengubah schema?
5. Known limitation dari fase 0: monorepo dengan DUA frontend berbeda tetap
   satu winner per kategori per scan. Apakah `fullstack` ikut terpengaruh /
   perlu caveat dokumentasi?
6. Naik versi schema atau tidak untuk nilai enum baru?

## 5. Referensi kode
- `packages/cli/src/analyzers/pipeline/projectMetadata.ts` — `ProjectType`,
  `detectProjectType`
- `packages/cli/src/analyzers/detectors/frameworkDetector.ts` — type
  `Framework` + FRONTEND/BACKEND order (berubah di fase 0)
- `packages/cli/src/cache/snapshot.ts` — normalisasi default projectType
- `update0.md` §4 — usulan asli

## 6. Rekomendasi
Skip dari fase utama; kalau dikerjakan → PR terpisah dengan test (fixture
monorepo fullstack, test prioritas bin/library, test backward-compat).
