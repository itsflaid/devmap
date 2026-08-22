# 6. Feature Detection Engine

**Source:** `packages/cli/src/analyzers/features/featureDetector.ts`

Ini adalah file terbesar di analysis engine (~1000 baris) dan yang paling
sering dirujuk oleh bab-bab lainnya. `detectFeatures()` adalah tempat
empat jenis bukti independen — peran file, kata kunci registry, kemampuan
rute, dan relasi entity — semuanya diubah menjadi bentuk `FeatureInfo`
yang sama dan digabungkan menjadi satu daftar.

```ts
export type FeatureInfo = {
  name: string;
  purpose: string;
  files: string[];
  entryPoint?: string;
  entryPoints: string[];
  businessFlow: string[];
  searchTerms: string[];
  confidence: "high" | "medium" | "low";
  evidence: string[];
};
```

## Empat sumber bukti, dijalankan secara berurutan

```ts
export function detectFeatures(
  files, analyses, routes, database?, entityGraph?, capabilities?, fileGraph?
): FeatureInfo[] {
  // 1. ROLE_FEATURES        — Documentation, Web Landing, CLI Commands
  // 2. FEATURE_SIGNALS      — registry-driven (ch. 5): Auth, Payments, Search, ...
  // 3. capabilitiesToFeatures — from route/capability detection (ch. 7)
  // 4. entityGraphToFeatures  — from entity relationships (ch. 4)
  //    + detectFrontendPageFeatures / detectClientRouteFeatures (ch. 10)
  return enrichAuthenticationFeature(features, scopedFiles, analyses)
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

Setiap sumber setelah yang pertama memanggil `mergeFeature()` alih-alih
langsung push — artinya fitur yang dideteksi dengan dua cara berbeda
(mis. "Payments" dari kecocokan kata kunci `FEATURE_SIGNALS` *dan*
kemampuan yang dideteksi dari `/api/checkout`) digabungkan menjadi satu
entri alih-alih muncul dua kali. `mergeFeature` adalah wrapper tipis yang
mendelegasikan ke similarity engine di ch. 8 — file ini tidak
mengimplementasikan logika merge sendiri.

### 1. `ROLE_FEATURES` — berbasis peran file

Tiga fitur (`Documentation`, `Web Landing`, `CLI Commands`) dideteksi
murni dari classifier `FileRole` (ch. 2), bukan kata kunci. Blok komentar
di atas `ROLE_FEATURES` menjelaskan apa yang secara sengaja *tidak* ada di
sini: peran architectural layer (`api-handler`, `service`, `middleware`,
`repository`, `ui-component`) dikecualikan karena itu adalah concern
implementasi, bukan fitur domain yang akan dikenali oleh seseorang;
`ai-integration` dikecualikan karena ditangani melalui `FEATURE_SIGNALS`
(deteksi berbasis import lebih reliable daripada berbasis peran untuk
yang satu ini).

Bukti `Documentation` melalui filter tambahan, `isDocumentationEvidence()`,
di atas pengecekan peran — ini mengecualikan file `.github/` dan
meta-file yang dikenal (`CONTRIBUTING.md`, `LICENSE.md`, `AGENTS.md`, dll.
— lihat `isDocumentationMeta` dari ch. 2) sehingga fitur "Documentation"
mencerminkan dokumentasi proyek yang nyata, bukan boilerplate repo.

### 2. `FEATURE_SIGNALS` — berbasis registry

Setiap descriptor `category: "feature"` dari registry ch. 5 dicocokkan
dengan set file yang sudah difilter sebelumnya (file sumber teknis, yang
memenuhi syarat bukti, tidak termasuk file definisi registry itu sendiri —
lihat `isRegistryFile`, yang ada untuk alasan pencocokan diri yang sama
dengan `serviceDetector.ts` yang mengecualikan dirinya sendiri di ch. 3).

`matchesSignal()` bercabang berdasarkan flag `importOnly`:

```ts
if (importOnly) {
  // AI Integration only — an actual import, a hardcoded provider URL, or
  // classifyFileRole === "ai-integration". Prose mentions don't count.
  ...
}
// Everything else: path segment match first, then import specifier match.
```

Pencocokan path (`matchesPathTerm`) memiliki strategi yang bergantung
pada panjang yang perlu dipahami jika sebuah signal pernah menghasilkan
false positive yang mengejutkan:

```ts
// ≤7 chars: word-boundary regex — "ai" must not match "detail"/"tailwind"/
//           "email"; "search" must not match "SearchSurah.tsx"
// ≥8 chars: plain substring — long terms are specific enough ("elasticsearch")
```

Istilah pendek berbahaya jika dibiarkan sebagai substring polos (`"ai"`
muncul di dalam lusinan kata yang tidak berhubungan), jadi mereka
mendapatkan pengecekan batas regex yang nyata
(`(?:^|[/._-])term(?:[/._-]|$)`), di-cache per-istilah di peta level
modul `regexCache` untuk menghindari kompilasi ulang pola yang sama di
seluruh file dalam pemindaian yang besar. Istilah yang panjang sudah
cukup panjang sehingga pengecekan batas menambah overhead tanpa mengurangi
false positive secara signifikan.

Setelah pencocokan, `signal.minimumDistinctFiles` (ch. 5) diterapkan —
tapi hanya terhadap bukti yang sudah lulus pengecekan **tier file**
(`primary` atau `supporting`, lihat di bawah), sehingga file tier
`reference` (mis. file konfigurasi) tidak bisa sendiri memenuhi
persyaratan file berbeda.

### 3. `capabilitiesToFeatures` — dari capability detection

Mengubah setiap `CapabilityInfo` (ch. 7) menjadi `FeatureInfo`, dengan
satu quality gate: **kemampuan yang tidak memiliki entry point yang bisa
diresolusi dan confidence bukan `"high"` dijatuhkan sepenuhnya**:

```ts
if (entryPoints.length === 0 && cap.confidence !== "high") return null;
```

Komentar menjelaskan alasannya secara langsung: pola rute yang cocok tanpa
file implementasi yang mendukung menghasilkan fitur dengan `criticalFiles`
kosong dan nama yang menyesatkan — lebih buruk daripada tidak mendeteksinya
sama sekali. `purposeFromCapability()` adalah switch sederhana berdasarkan
jenis kemampuan (`crud`, `sharing`, `collaboration`, `discovery`,
`publishing`, `social`, `file-management`, `real-time`, `search`,
`reporting`) yang menghasilkan kalimat tujuan yang mudah dibaca untuk
masing-masing.

### 4. `entityGraphToFeatures` — model kepemilikan

Ini yang paling menarik secara konsep dari empat sumber bukti. Tidak
setiap entity menjadi fiturnya sendiri — pendekatan naive "satu fitur per
tabel" akan mengubah sesuatu seperti `ChecklistItem` (baris anak yang
hanya pernah ada di bawah `Message`) menjadi fitur mandiri yang membingungkan.
Sebaliknya, setiap entity diklasifikasikan berdasarkan posisinya dalam
graf relasi:

| Klasifikasi | Aturan | Hasil |
|---|---|---|
| **Anak sejati** | Tepat satu parent melalui one-to-many, DAN (tidak memiliki anak sendiri ATAS akhiran nama seperti anak: `Item`, `Entry`, `Detail`, `Line`, `Row`, `Part`, `Step`, `Variant`, `Option`) | Dilewati sebagai mandiri — dilipat ke string tujuan parent |
| **Mandiri** | Beberapa parent, atau memiliki entity lain (simpul perantara) | Mendapat fitur `"<Entity> Management"` sendiri |
| **Dimiliki** | Non-infrastruktur, non-anak-sejati, dimiliki melalui one-to-many/one-to-one | Dinamai di tujuan fitur yang memiliki (`buildEntityPurpose`) |
| **Sejawat** | Asosiasi many-to-many | Dinamai di tujuan sebagai "berkaitan dengan X" |

`INFRASTRUCTURE_ENTITY_NAMES` (`Account`, `Session`, `VerificationToken`,
`AuditLog`, dll.) dikecualikan dari menjadi fitur sama sekali, tanpa
melihat relasi — ini ada untuk mendukung sistem eksternal (internals
NextAuth/Lucia, tabel audit), bukan domain aplikasi itu sendiri. Komentar
pada set ini secara eksplisit mencatat pengecualian "Account" aman bahkan
untuk proyek yang *memiliki* konsep domain nyata bernama "Account" (mis.
akun penagihan) — yang tetap muncul melalui `FEATURE_SIGNALS` atau
kemampuan.

Setelah sebuah entity dikonfirmasi mandiri, **file**-nya ditemukan melalui
`findEntityFiles()` — mencocokkan path segment dengan nama entity yang
dibagi menjadi kata-kata (`ChecklistItem` → `checklist`, `item`),
diberi tier sehingga file `.prisma` berada di atas file migrasi — kecuali
entity sudah membawa `sourceFiles` dari ekstraksi (ch. 4's `SQLExtractor`
mengatur ini, karena referensi tabel SQL mentah tidak memiliki konvensi
nama file yang bisa diandalkan untuk dicari).

## Tiering file dan skor entry-point — digunakan oleh semua jalur di atas

Dua fungsi kecil dikonsultasikan oleh keempat sumber bukti, itulah
sebabnya mereka berada di scope modul alih-alih di dalam satu cabang
mana pun:

**`classifyFileTier(path)`** → `"primary" | "supporting" | "reference" |
"excluded"`. Migrasi, file `.sql`, kode yang di-generate, dan lockfile
secara langsung `excluded`. `schema.prisma` dan `*.config.*` adalah
`reference` (konteks yang berguna, bukan sesuatu yang akan kamu tunjukkan
kepada seseorang terlebih dahulu). Apa pun di bawah `api/`/`routes/`,
file bernama `*.service.*`/`*.action.*`/dll., dan apa pun di bawah
`hooks/`/`stores/` adalah `primary`. Sisanya yang mirip sumber adalah
`supporting`.

**`scoreEntryPointRelevance(file)`** — skor yang *lebih rendah* berarti
kandidat entry-point yang *lebih baik* (ini adalah "golf score", bukan
confidence score). File utilitas generik (`utils.ts`, `helpers.ts`,
`types.ts`) bernilai 100 — secara efektif didiskualifikasi melalui
`ENTRY_POINT_EXCLUDE_THRESHOLD = 90`. Route handler bernilai 5, file
`api/` bernilai 10, CLI command bernilai 15, service bernilai 20-25 —
urutan ini mencerminkan "seberapa besar kemungkinan pemula benar-benar
ingin mulai membaca dari sini."

Baik `capabilitiesToFeatures` maupun `entityGraphToFeatures` memfilter
kandidat entry-point melalui **kedua** fungsi bersama-sama: skor di bawah
threshold, *dan* tier adalah `primary` atau `supporting` — sebuah file
bisa lulus satu pengecekan tapi gagal di yang lain, dan keduanya harus
setuju.

## Subistem peran semantik autentikasi

**Source:** `detectAuthenticationSemanticRole()`, diekspor dari file ini

Ini adalah bagian yang paling sering dirujuk dari luar bab ini dalam
codebase — ch. 1 menunjukkan bahwa ia dikonsultasikan dua kali di dalam
`projectMap.ts` untuk formula scoring yang tidak berhubungan. Di dalam
file ini sendiri, ini adalah faktor penentu untuk file mana yang dilipat
ke dalam fitur `Authentication` melalui
`collectAuthenticationFeatureFiles()`.

Ini mengklasifikasikan file ke dalam salah satu dari empat peran,
diperiksa sesuai urutan prioritas (file yang cocok dengan aturan lebih
awal tidak pernah jatuh ke aturan yang lebih lambat):

```ts
export type AuthSemanticRole = "auth-config" | "guard" | "provider" | "consumer";
```

1. **`auth-config`** — file *adalah* pengaturan autentikasi itu sendiri:
   `src/auth.ts`/`auth.ts` berdasarkan konvensi, atau konten yang
   merujuk simbol bertipe NextAuth (`nextauth`, `getServerSession`,
   `credentials`, `authConfig`) bersama dengan import autentikasi.
2. **`guard`** — file middleware/proxy, atau file apa pun yang menunjukkan
   *keduanya* sinyal autentikasi (path/import/simbol) *dan* sinyal guard
   (`guard`, `middleware`, `proxy`, `protected`) — sebuah file bisa
   berdekatan dengan autentikasi tanpa menjadi guard, jadi keduanya harus
   hadir.
3. **`provider`** — filename berbentuk `providers.ts` yang dikombinasikan
   dengan import atau simbol autentikasi (React context provider yang
   membungkus aplikasi dalam sebuah sesi).
4. **`consumer`** — yang mencakup semua: file layout/app-shell yang
   menggunakan simbol pengonsumsi sesi (`useSession`, `signOut`,
   `useAuth`), atau, jika semua di atas gagal, sekadar *file apa pun*
   dengan sinyal path, import, atau simbol autentikasi.

`collectAuthenticationFeatureFiles()` menjalankan setiap file teknis-fitur
sumber arsitektur melalui classifier ini (dengan fallback yang graceful —
`extractImportsFallback`/`extractSymbolsFallback` merekonstruksi import
dan simbol melalui regex ringan ketika `FileAnalysis` nyata tidak tersedia)
dan hanya menyimpan file yang resolve ke peran non-`null`. Ia juga secara
eksklusif mengecualikan file di bawah `analyzers/`/`detectors/` dan apa
pun yang berbentuk `*analyzer.ts`/`*detector.ts`
(`isAnalyzerImplementationFile`) — jika tidak, DevMap yang menganalisis
codebase-nya *sendiri* akan menandai `frameworkDetector.ts` (yang secara
sah menyebut "auth" di komentar dan identifier) sebagai bagian dari fitur
Autentikasi sebuah proyek.

Jika fitur `Authentication` sudah ada dari `FEATURE_SIGNALS`, langkah
pengayaan **bergabung ke dalamnya** (gabungan file, confidence dihitung
ulang) alih-alih membuat entri kedua — ini berjalan *setelah* tiga sumber
bukti lainnya secara khusus sehingga ia bisa mengaya apa pun yang sudah
dihasilkan oleh mereka.

### Daftar prioritas terpisah namun terkait

`orderAuthenticationFiles()` / `authenticationFilePriority()` menentukan
*urutan tampilan* setelah file sudah dipilih — proxy/middleware terlebih
dahulu (10), `auth.ts` berikutnya (20), lalu rute API autentikasi,
halaman login/register, provider, dan akhirnya shell layout/dashboard
(80). Ini adalah concern yang berbeda dari
`FEATURE_FILE_PRIORITIES["Authentication"]` (digunakan oleh
`featureFilePriority()` generik untuk *peringatan awal* bukti sebelum
penggabungan) — dua tabel pengurutan terpisah untuk file autentikasi yang
secara kebetulan sejalan secara prinsip tapi bukan jalur kode yang sama.
Jika kamu mengubah cara file autentikasi diurutkan, periksa yang mana
dari kedua fungsi yang benar-benar dilalui oleh call site kamu.

## Lihat juga

- Ch. 1 untuk `calculateSemanticImportanceBonus`/`calculateCriticalSemanticBonus`,
  dua fungsi `projectMap.ts` yang juga memanggil
  `detectAuthenticationSemanticRole`
- Ch. 5 untuk asal `FEATURE_SIGNALS` dan flag `importOnly`/
  `minimumDistinctFiles`-nya
- Ch. 7 untuk `CapabilityInfo`, input ke `capabilitiesToFeatures`
- Ch. 8 untuk apa yang benar-benar dilakukan `mergeFeature`/
  `mergeIntoFeatureList`
- Ch. 10 untuk `detectFrontendPageFeatures`/`detectClientRouteFeatures`
