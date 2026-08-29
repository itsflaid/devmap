# 8. Similarity & Merge

**Source:** `packages/cli/src/analyzers/features/featureSimilarity.ts`,
`featureMerge.ts`

Ada enam tempat di codebase yang perlu menjawab "apakah dua feature ini
sebenarnya hal yang sama?" — feature berbasis role yang di-merge dengan
feature berbasis signal, feature yang diturunkan dari capability yang
di-merge dengan feature yang diturunkan dari entity, dan (kasus paling
sulit) feature domain yang di-infer oleh AI yang di-merge dengan semua
temuan dari static analysis. Chapter ini adalah jawaban bersama yang
digunakan oleh semua kasus tersebut.

## Masalah yang dipecahkan oleh modul ini

Docblock modul ini langsung menyebutkan sejarahnya, dan layak untuk
diulang karena menjelaskan *mengapa* modul ini ada sebagai concern
terpisah daripada digabung ke dalam `featureDetector.ts`:

> Sebelumnya logika merge tersebar di dua tempat: `featureDetector.ts`
> yang menggunakan perbandingan nama saja, dan `projectMap.ts` yang
> menggunakan kesetaraan `f.name.toLowerCase()` untuk domain features.
> Keduanya punya kelemahan yang sama: **mengandalkan nama sebagai
> identitas.** `"Plan Management"` dan `"Customizable Plans"` tidak akan
> pernah di-merge, karena namanya berbeda — padahal mereka mendeskripsikan
> hal yang persis sama, hanya AI kebetulan merumuskannya dengan dua cara
> berbeda di dua run berbeda.

Poin terakhir itu penting secara khusus karena rumusan AI tidak stabil
antara run (domain inference di chapter 11 bisa merumuskan feature yang
sama dengan cara berbeda setiap kali dipanggil), jadi merge berbasis
kesetaraan nama akan membuat feature duplikat setiap kali rumusannya
sedikit saja berubah.

## `computeSimilarity()` — empat faktor berbobot

```ts
export type FeatureIdentity = {
  name: string;
  files: string[];
  searchTerms: string[];
  relatedEntities: string[];
  purpose?: string;
};

const DEFAULT_WEIGHTS = {
  fileOverlap: 0.45,     // most reliable — concrete, unambiguous evidence
  termOverlap: 0.25,
  entityOverlap: 0.20,
  nameSimilarity: 0.10,  // least reliable — AI wording is volatile
};
```

`FeatureIdentity` secara sengaja merupakan tipe yang lebih sempit dari
`FeatureInfo` — hanya field yang cukup untuk perbandingan, sehingga modul
ini tidak perlu mengimpor tipe feature yang lengkap dan tetap bisa
dipakai secara terpisah (docblock mencatat ini sebagai fondasi untuk
sistem persistensi fingerprint di masa depan).

Tiga dari empat faktor menggunakan **Jaccard similarity** (`|A ∩ B| / |A ∪ B|`)
di atas set — file, search terms yang sudah dinormalisasi, dan related
entities yang sudah dinormalisasi. Dua feature yang tidak berbagi file
dan tidak berbagi term mendapat skor `0`; dua set yang identik mendapat
skor `1`; dua set **kosong** juga mendapat skor `1` ( alasannya: dua
feature yang tidak punya data file bukanlah "konflik," jadi memperlakukan
itu sebagai similarity maksimum daripada minimum menghindari artifact
data kosong yang menarik skor komposit ke bawah secara tidak adil).

Faktor keempat, similarity nama, menggunakan **trigram Dice coefficient**
bukan edit distance — komentar dokumen menjelaskan alasannya: overlap
trigram lebih robust dibanding Levenshtein untuk nama pendek dengan
rumusan berbeda, persis kasus `"Plan Management"` vs `"Customizable Plans"`
(~0.28 trigram similarity — rendah, tapi *tiga faktor lainnya* yang
sebenarnya membawa pasangan tersebut melewati threshold).

Skor komposit adalah weighted sum lurus, dengan threshold `0.35` secara
default — dipilih, menurut komentar dokumen, sehingga `"Plan Management"`
dan `"Customizable Plans"` (overlap entity + term, rendah similarity nama)
cocok, sementara `"Authentication"` dan `"Search"` (tidak ada overlap
apa pun) tidak cocok, dan `"Search"` vs `"Search Functionality"` (overlap
term) cocok.

## `findSimilarFeature()` — best match, bukan first match

```ts
export function findSimilarFeature(
  candidates: FeatureIdentity[], target: FeatureIdentity, thresholdOrConfig?
): { index: number; score: number } | null
```

Menskor setiap kandidat dan mengembalikan satu kandidat dengan skor
**tertinggi** yang melewati threshold — bukan yang pertama melewati
threshold. Ini penting ketika sebuah feature baru kemungkinan cocok dengan
dua entri yang sudah ada; memilih yang terbaik daripada yang pertama
menghindari urutan merge menjadi sumber nondeterminism yang tersembunyi.

## Merge itu sendiri: perkaya, jangan rename

**Source:** `featureMerge.ts`

`mergeIntoFeatureList(features, addition)` adalah satu fungsi yang
menggantikan kedua call site lama yang tersebar. Aturan yang membuat
output tetap stabil di antara beberapa run:

> **Nama kanonik: yang pertama kali ditemukan menang, dan tidak pernah
> di-override.**

Jika `"Plan Management"` sudah ada di list dan `"Customizable Plans"` yang
di-infer oleh AI kemudian di-merge ke dalamnya, entri tersebut tetap
mempertahankan nama `"Plan Management"` — meskipun rumusan AI-nya
mungkin terasa lebih baik. Stabilitas lintas run dihargai lebih tinggi
daripada rumusan di satu run tertentu.

`mergeFeatureData()` — kombinasi field-by-field yang sebenarnya —
memperlakukan setiap field secara berbeda, dan alasannya layak dipahami
karena ini jenis hal yang mudah salah secara subtil jika kamu menyentuh
kode ini:

| Field | Aturan | Alasan |
|---|---|---|
| `name` | yang sudah ada menang, selalu | identitas kanonik, lihat di atas |
| `purpose` | yang sudah ada menang, **kecuali** yang sudah ada adalah fallback auto-generated generik dan yang ditambahkan bukan | `isGenericPurpose()` mendeteksi boilerplate seperti `"Identifies X capability..."`/`"Manages X data and operations."` — purpose spesifik yang ditulis AI layak untuk di-upgrade, purpose *static* spesifik tidak boleh di-override oleh yang generik |
| `files`, `evidence`, `entryPoints` | union, deduplicated | lebih banyak evidence jelas lebih baik |
| `searchTerms` | union, deduplicated, dibatasi `MAX_SEARCH_TERMS` (8) | menjaga field tetap terbatas di antara beberapa merge |
| `confidence` | yang lebih tinggi dari keduanya | menggabungkan evidence tidak boleh membuat feature terlihat *kurang* yakin |
| `businessFlow` | yang sudah ada menang jika tidak kosong dan bukan placeholder, else yang ditambahkan | `isPlaceholderBusinessFlow()` memeriksa stub auto-generated `"Identify files related to..."` |

### Bagaimana `relatedEntities` diturunkan untuk faktor entity-overlap

`toFeatureIdentity()` tidak punya field entities khusus di `FeatureInfo`
yang bisa dibaca langsung — `extractRelatedEntities()` merekonstruksinya
dari dua sinyal yang lebih sempit alih-alih mempercayai semua
`searchTerms` (yang mencampur nama entity dengan keyword teknis generik
dari `FEATURE_SIGNALS`):

1. Regex terhadap nama feature itu sendiri: `"X Management"`/`"X System"`/
   `"X Module"`/`"X Feature"`/`"X Service"` → `X` hampir pasti nama
   entity.
2. Setiap search term yang Title Case — karena term `FEATURE_SIGNALS`
   generik secara konvensi lowercase (chapter 5), term yang diawali huruf
   kapital dibaca sebagai nama entity yang bocor ke `searchTerms`, bukan
   keyword teknis.

Ini jaring yang lebih sempit secara sengaja — komentar mencatat keyword
teknis generik tetap berkontribusi pada faktor overlap *term*; overlap
entity ditangkap secara spesifik untuk bukti nama entity, bukan
menghitung dua kali term yang sama.

## `mergeDomainFeatures()` — titik masuk merge AI

Loop ringan yang memanggil `mergeIntoFeatureList` sekali untuk setiap
feature yang di-infer oleh AI — ini persis yang ditunjukkan chapter 1
sebagai pemanggil dari Step 4 `createProjectMap`, dan ini alasan mengapa
feature yang disarankan AI tidak akan pernah diam-diam menduplikasi
sesuatu yang sudah ditemukan oleh static analysis.

## Sebuah fitur fondasi yang belum terhubung

`buildFeatureFingerprint()`/`fingerprintSimilarity()` di bagian bawah
`featureSimilarity.ts secara eksplisit **belum digunakan di mana pun** —
komentar menandainya sebagai fondasi untuk kemungkinan lapisan persistensi
`.devmap/fingerprints.json` di masa depan yang memungkinkan feature
dicocokkan berdasarkan fingerprint di antara beberapa run `devmap analyze`
terpisah, bukan hanya dalam satu list in-memory seperti saat ini. Jika
kamu mencari di mana identitas feature berbasis fingerprint *digunakan*,
saat ini belum ada — ini infrastruktur yang berorientasi masa depan,
bukan sub-sistem yang sudah terpasang.

## Lihat juga

- Chapter 6 untuk empat sumber evidence yang semuanya melewati `mergeFeature`
- Chapter 11 untuk peran `mergeDomainFeatures` di Step 4 `createProjectMap`
- Chapter 1 untuk call site di `projectMap.ts`
