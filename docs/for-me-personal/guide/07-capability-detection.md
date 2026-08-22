# 7. Capability Detection

**Source:** `packages/cli/src/analyzers/detectors/capabilityDetector.ts`

Feature detection (ch. 6) menjawab "library apa yang digunakan proyek ini?"
Capability detection menjawab pertanyaan berbeda: "apa yang proyek ini
benar-benar **izinkan pengguna untuk lakukan**, berdasarkan bentuk rute
API-nya?" Tabel rute dengan `GET/POST/PUT/DELETE /snippets` mengimplikasikan
CRUD pada entity `Snippet` apakah kode tersebut mengimport sesuatu yang
kamu kenali namanya atau tidak.

```ts
export type CapabilityKind =
  | "crud" | "sharing" | "collaboration" | "discovery" | "publishing"
  | "social" | "file-management" | "real-time" | "search" | "reporting";

export type CapabilityInfo = {
  kind: CapabilityKind;
  name: string;
  entities: string[];   // entity mana yang dioperasikan
  evidence: string[];   // file rute
  confidence: "high" | "medium" | "low";
};
```

## Dua tahap deteksi, keduanya hanya-API-rute

`detectCapabilities()` menjalankan dua tahap independen dan
mendeduplikasi berdasarkan `kind` di akhir:

### Tahap 1 — CRUD, dikelompokkan berdasarkan resource

Segmen path non-generik pertama dari setiap rute API menjadi sebuah
"resource" (`extractResourceName` — menghapus segmen dinamis, awalan
versi `v1/v2/v3`, dan apa pun yang lebih pendek dari 3 karakter). Rute
dikelompokkan berdasarkan resource, dan metode HTTP dari semua rute
resource tersebut digabungkan: ada `GET` → punya-read, ada
`POST/PUT/PATCH` → punya-write, ada `DELETE` → punya-delete. Sebuah
resource membutuhkan setidaknya bukti read *atau* write untuk dihitung
sama sekali; memiliki ketiganya (read + write + delete) meningkatkan
confidence ke `"high"` alih-alih `"medium"`.

Nama resource di-resolve ke nama entity sungguhan melalui
`resolveEntityName()` — pertama mencoba pencocokan case-insensitive yang
persis terhadap `entityGraph.entityNames`, lalu pencocokan singularisasi,
fallback ke sekadar mengkapitalisasi string resource (yang sudah
disingularisasi) jika tidak ada pencocokan entity graph sama sekali.
Artinya kemampuan CRUD tetap mendapatkan nama yang masuk akal bahkan pada
proyek di mana ekstraksi entity (ch. 4) menghasilkan kosong sepenuhnya.

### Tahap 2 — sinyal perilaku, dari tabel sinyal yang sudah disesuaikan

`BEHAVIORAL_SIGNALS` adalah sepuluh entri yang disesuaikan secara manual
(sharing, publishing, collaboration, discovery, social, file-management,
real-time, search, reporting — ditambah CRUD dari tahap 1) masing-masing
dengan **daftar pola path** sendiri dan **dua threshold independen**:

```ts
type BehavioralSignal = {
  kind: CapabilityKind;
  name: string;
  pathPatterns: RegExp[];
  highConfidenceAt: number;    // jumlah kecocokan yang dibutuhkan untuk confidence "high"
  minimumMatches?: number;     // jumlah kecocokan yang dibutuhkan untuk muncul sama sekali (default 1)
};
```

## Mengapa threshold disesuaikan seperti ini

Ini layak dibaca langsung dari komentar sumber karena ini adalah sejarah
desain yang nyata, bukan sekadar tabel angka ajaib:

> `highConfidenceAt = 1` terlalu agresif — satu kecocokan rute pada path
> generik seperti `/search` atau `/stats` sudah cukup untuk membuat fitur
> confidence "high", bahkan ketika rute tersebut hanya halaman UI.

Perbaikannya memiliki dua bagian, keduanya masih terlihat di kode saat ini:

1. **Deteksi perilaku hanya berjalan pada rute API, tidak pernah rute
   halaman.** `detectCapabilities()` memfilter ke `apiRoutes` sebelum
   memanggil `detectBehavioralCapabilities` — rute **halaman** `/search`
   adalah pola UI (ada kotak pencarian di suatu tempat), bukan bukti
   infrastruktur pencarian. Hanya rute berbentuk `/api/search` yang
   dihitung.
2. **Threshold per-sinyal, dipilih berdasarkan seberapa ambigu pola
   path-nya:**

   | Capability | `minimumMatches` | `highConfidenceAt` | Mengapa |
   |---|---|---|---|
   | Search | 2 | 2 | Satu `/api/search` bisa jadi hanya filter daftar sederhana, bukan infrastruktur pencarian sungguhan |
   | Social | 2 | 3 | Satu rute `/comments` bisa jadi apa saja — butuh beberapa sinyal sosial (*dan* komentar, misalnya) sebelum dihitung |
   | Sharing, Collaboration, Reporting | 1 | 1–2 | Pola path cukup spesifik (`workspace`, `invite`, `report`) sehingga satu kecocokan bermakna, tapi confidence tetap butuh 2 untuk yang kurang jelas |
   | Publishing, Discovery, File Management, Real-time | 1 | 1 | Pola path cukup spesifik sehingga satu kecocokan sudah cukup untuk muncul *dan* cukup untuk confidence tinggi |

Jika kamu sedang menambahkan sinyal perilaku baru, pola yang perlu diikuti
adalah: mulailah dengan bertanya berapa banyak hal yang *tidak
berhubungan* yang bisa dimaknai oleh sebuah segmen path yang cocok dalam
proyek arbitrari. `/api/live` hampir selalu real-time; `/api/stats` tidak
selalu infrastruktur reporting sungguhan (banyak aplikasi punya
`/dashboard` yang hanya halaman landing). Semakin generik kosakata
path-nya, semakin tinggi kedua threshold-nya.

## Deduplikasi dan penggabungan confidence

Kedua tahap bisa menghasilkan entri dengan `kind` yang sama (pola resource
yang cocok dengan bentuk CRUD *dan* sinyal perilaku).
`deduplicateCapabilities()` menyimpan satu entri per kind, menggabungkan
`entities` dan `evidence` (dibatasi 5 file) dan mempertahankan yang
**lebih tinggi** dari kedua confidence melalui peta ranking sederhana
(`{ high: 2, medium: 1, low: 0 }`).

## `singularize()` ketiga yang independen

Layak disorot karena mudah dilewatkan: file ini memiliki `singularize()`
privatnya sendiri, secara struktur mirip tapi **bukan fungsi yang sama**
dengan yang diekspor dari `analysis/extractors/fallbackExtractor.ts`
(ch. 4) — yang ini tidak memiliki peta kata tak beraturan (`people` →
`person`, dll.) dan penanganan akhiran yang sedikit berbeda. Dua
implementasi independen dan bergerak dari konsep yang sama di seluruh
codebase. Jika nama resource salah disingularisasi di sebuah capability
tapi benar di sebuah entity, atau sebaliknya, periksa fungsi mana yang
benar-benar berjalan.

## Lihat juga

- Ch. 4 untuk `EntityGraph`/`entityNames`, yang dikonsumsi oleh
  `resolveEntityName`
- Ch. 6 untuk `capabilitiesToFeatures()`, yang mengubah output bab ini
  menjadi entri `FeatureInfo` (dan menjatuhkan yang confidence-nya rendah
  tanpa entry point yang bisa diresolusi)
- Ch. 3 untuk asal input `RouteInfo[]`
