# 14. Snapshot, Cache & Config

**Source:** `packages/cli/src/cache/`, `packages/cli/src/utils/config.ts`

Beberapa bagian struktural terakhir: bagaimana `snapshot.json` ditulis,
dibaca kembali, dan dimigrasi dengan aman di lintas perubahan schema; dua algoritma hash
berbeda yang digunakan di seluruh codebase dan mengapa keduanya berbeda; serta bagaimana
DevMap menyelesaikan konfigurasinya sendiri di dua file.

## MD5 vs SHA-256 — dua hash, dua tujuan, tidak bisa dipertukarkan

Kamu akan menemui keduanya di seluruh panduan ini, dan layak memahami
perbedaannya di satu tempat:

| | `hashContent()` (`cache/fileHash.ts`) | cache key domain-inference (ch. 11) |
|---|---|---|
| Algoritma | MD5 | SHA-256 |
| Input | konten mentah satu file | seluruh `DomainInferenceInput` yang di-serialize |
| Digunakan untuk | fingerprint konten per-file (`fileIndex[path].hash`), dan — yang di-konkatenasi di seluruh file — `fingerprint` seluruh proyek (ch. 1) | cache key apakah panggilan AI domain-inference bisa dilewati |
| Mengapa algoritma ini | kecepatan, penggunaan non-kriptografis — ini berjalan sekali per file di setiap scan | bukan security boundary, tetapi dipasangkan dengan field `v: 2` schema-version yang dibakar ke dalam payload yang di-hash, sehingga perubahan bentuk di masa depan bisa secara sengaja membatalkan setiap cache entry yang ada |

Keduanya tidak digunakan untuk sesuatu yang sensitif secara keamanan — keduanya murni
fingerprint identitas konten. Alasan keduanya tidak dipersatukan ke satu utility
bersama adalah karena mereka menyelesaikan masalah yang benar-benar berbeda: satu perlu
cepat dan berjalan per-file saat scan di potensi ribuan file,
yang lain berjalan sekali per panggilan `analyze` terhadap payload terstruktur kecil
dan mendapat keuntungan dari field versi eksplisit untuk mengontrol invalidasi.

## Snapshot persistence: `cache/snapshot.ts`

`saveSnapshot()`/`readSnapshot()` adalah pasangan read/write untuk
`.devmap/snapshot.json`. Bagian yang menarik adalah `inspectSnapshot()` — jalur
validasi penuh, mengembalikan tagged union alih-alih throw
langsung, sehingga setiap caller bisa memutuskan sendiri bagaimana merespons setiap
hasil:

```ts
type SnapshotStatus =
  | { status: "missing" }
  | { status: "valid"; snapshot: ProjectMap }
  | { status: "corrupt"; error: string }
  | { status: "unsupported"; version: string };
```

Validasi bersifat berlapis, pemeriksaan termurah terlebih dahulu: apakah ini JSON yang valid dan
objek sama sekali → apakah `parsed.version` match dengan
`SNAPSHOT_SCHEMA_VERSION` secara persis (**ketidakcocokan mengembalikan `"unsupported"`,
bukan mencoba auto-upgrade** — lebih lanjut di bawah) → apakah field-level atas yang wajib
ada dengan tipe container yang tepat → apakah setiap entry
di `fileIndex` lolos pemeriksaan struktural ringan (`isFileIndexEntry` —
empat field wajib, bukan validator schema penuh). Hanya setelah semua itu
lulus barulah `normalizeSnapshotDefaults()` dijalankan.

### Dua jenis "snapshot lama" berbeda, ditangani dengan dua cara berbeda

Layak dipahami secara presisi tentang perbedaan yang ditarik oleh kode itu sendiri:

- **Field `version` yang tidak match dengan `SNAPSHOT_SCHEMA_VERSION` sama sekali**
  → `"unsupported"`. `readSnapshotOrThrow()` mengubah ini menjadi
  error yang memberi tahu pengguna untuk menjalankan `devmap analyze --fresh`. DevMap
  tidak mencoba melakukan migrasi melintasi perubahan schema major yang tidak kompatibel.
- **Snapshot di versi schema *saat ini*, tetapi field yang ditambahkan di perubahan minor
  berikutnya tidak ada** (field opsional baru diperkenalkan tanpa bump versi)
  → ditangani sepenuhnya di dalam `normalizeSnapshotDefaults()`,
  yang menambal default yang masuk akal untuk apa pun yang kurang: array
  `flows` kosong, `onboarding.recommendedPath` kosong, peta
  `changeImpact` kosong, `"medium"` confidence untuk feature yang kekurangannya,
  dan seterusnya.

Migrasi `projectTypes` di dalam fungsi tersebut adalah shim yang paling rumit,
dan komentarnya secara eksplisit melakukan cross-reference ke kode yang harus tetap
sinkron dengannya:

```ts
// Migration shim for snapshots that predate `projectTypes`. The canonical
// field is now an array so a single project can be both a CLI and a web
// app (mixed workspaces). Mirrors the framework-first classification in
// detectProjectTypes() (analyzers/pipeline/projectMetadata.ts) — keep
// the two in sync.
```

Snapshot yang ditulis sebelum dukungan multi-type ada hanya memiliki string
`project.projectType` tunggal (atau, lebih lama lagi, tidak ada sama sekali — di-infer
dari `framework` melalui lookup set frontend/backend yang sama dengan
daftar framework ch. 3). Shim ini ada secara khusus agar `snapshot.json` lama
tidak perlu di-generate ulang hanya karena versi DevMap yang lebih baru
membaca field yang sebelumnya tidak ada — tetapi ini berarti logika fallback
shim dan logika deteksi aktual `projectMetadata.ts` adalah dua implementasi
terpisah dari "bagaimana kita menebak tipe proyek," yang satu live dan yang
lainnya beku-dalam-amber untuk backward compatibility. Jika
logika `detectProjectTypes()` berubah secara signifikan, inferensi shim ini
tidak otomatis mengikutinya — itulah yang dimaksud dengan "keep the two in sync" yang
diminta oleh komentar kepada siapa pun yang mengedit salah satu sisi.

Rename kecil serupa ada tepat di atasnya: nilai lama
`agentInstructions.navigationPolicy` dari `"snapshot-first"` di-
ubah ke `"index-first"` masa kini — jejak langsung dari filosofi navigasi
proyek yang pernah berubah pada suatu titik (snapshot.json dulunya
menjadi artifact utama yang menghadap agent; `index.json` + feature maps
ch. 13 mengambil peran tersebut nanti).

`isSnapshotStale()` adalah helper kecil terpisah — scan ulang proyek,
hitung ulang fingerprint, bandingkan dengan yang tersimpan. Ini adalah
mekanisme fingerprint yang sama dari ch. 1, hanya dipanggil secara standalone (digunakan oleh
`devmap doctor` dan di mana pun yang membutuhkan pengecekan stale/fresh tanpa
menjalankan `analyze` penuh).

## Config: dua file, satu arah merge

**Source:** `utils/config.ts`

Dua file config terpisah, secara sengaja dengan cakupan yang berbeda:

- **Global** (`~/.devmap/config.json`) — `{ provider, apiKey?, model }`.
  Ini adalah satu-satunya tempat API key pernah dibaca.
- **Lokal** (`<project>/.devmap/config.local.json`) — hanya `{ model? }`.

`resolveEffectiveConfig()` membaca global terlebih dahulu (jika tidak ada,
tidak ada config sama sekali — langsung kembalikan `null`, tidak perlu baca
lokal), lalu menimpa lokal **hanya jika ia menentukan model**:

```ts
return local?.model ? { ...global, model: local.model } : global;
```

Ini memungkinkan satu proyek mengunci model tertentu (misalnya, model yang lebih besar
untuk monorepo besar) tanpa menduplikasi — atau berisiko meng-commit secara tidak sengaja —
API key ke config per-proyek yang mungkin di-version-control.
`readLocalConfig()` secara aktif menjaga batas ini: jika `apiKey` atau
`provider` muncul di `config.local.json`, keduanya diam-diam diabaikan
dan peringatan dicetak (`output.warning`, area ch. commands 7 perintah `config`)
bukan error atau — lebih buruk — diam-diam diterapkan. `normalizeConfig()` juga
mempertahankan file *global* secara defensif: nilai `provider` yang invalid atau
`model`/`apiKey` yang bukan string menyebabkan seluruh config diperlakukan sebagai
tidak ada (`null`) daripada dipercaya sebagian.

## Lihat juga

- Ch. 1 untuk `createProjectFingerprint`/`SNAPSHOT_SCHEMA_VERSION` dan di mana
  keduanya diproduksi
- Ch. 3 untuk `FRONTEND_FRAMEWORK_SET`/`BACKEND_FRAMEWORK_SET`, yang digunakan
  ulang langsung oleh shim migrasi `projectTypes`
- Ch. 11 untuk cache domain-inference SHA-256, separuh lainnya dari
  perbandingan algoritma hash di atas
- Ch. 13 untuk `index.json`/feature maps, artifact yang membuat
  `navigationPolicy` beralih dari `"snapshot-first"`
