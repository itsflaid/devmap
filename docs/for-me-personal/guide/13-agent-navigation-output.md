# 13. Agent Navigation Output

**Source:** `packages/cli/src/cache/agentNavigation.ts`

Semua yang dibangun di ch. 1–12 membangun `ProjectMap` di memori. Ch. ini
adalah tempat di mana data tersebut benar-benar menjadi file yang dibaca oleh AI coding agent:
`.devmap/index.json` dan `.devmap/features/*.json`. Kalau `docs/generated-files.md`
memberitahu kamu *apa* isi file-file ini, ch. ini menjelaskan *bagaimana*
file-file ini dibangun dan — yang lebih penting — *mengapa* peringkat di dalamnya
bekerja seperti yang dilakukannya. Ini bisa dibilang produk yang sebenarnya: semua yang ada di upstream
ada untuk menghasilkan input yang baik ke file ini.

## Dua view dari feature yang sama, dengan dua granularitas

`writeAgentNavigationFiles()` menghasilkan satu pointer ringan per feature
(di dalam `index.json`) dan satu peta detail per feature (`features/<id>.json`)
— secara sengaja bentuk berbeda untuk pola navigasi "browse, lalu drill in":

```ts
type AgentFeatureIndex = {
  id: string; name: string; summary: string;
  keywords: string[]; criticalFiles: string[]; map: string; // pointer ke file detail
};
```

vs. feature map lengkap, yang juga membawa `entryPoints`,
`relatedFiles` (setiap file, masing-masing dengan string `role` yang di-infer),
langkah `flow` opsional, maksimal 12 `keywords`, `confidence`, dan —
field yang sebenarnya dimaksudkan untuk dibaca dari atas ke bawah — `sourcePriority`.

### `featureId()` dan jaring pengaman dedup

Nama feature diubah menjadi slug (`"Checklist Item Management"` →
`"checklist-item-management"`) melalui transform lowercase-and-hyphenate yang
sederhana. Langkah dedup yang ada secara langsung mengakui bahwa
dua nama dengan kapitalisasi atau tanda baca berbeda bisa berbenturan
pada slug yang sama — yang ditemukan pertama menang, prinsip stabilitas yang sama
dengan yang digunakan ch. 8 untuk identitas feature.

Sebelum menulis file feature baru, semua file `.json` yang ada di
`.devmap/features/` dihapus (`removeStaleFeatureMaps`) — inilah yang
mencegah feature yang di-rename atau dihapus meninggalkan file yang terbengkalai
setelah re-analyze.

### `sourcePriority` — satu lagi formula pengurutan file

Di dalam peta detail satu feature, `sourcePriority` mengurutkan file
milik feature tersebut berdasarkan: apakah itu entry point (pertama), lalu posisi aslinya di
`feature.files` (mempertahankan urutan apa pun yang dihasilkan oleh deteksi upstream),
lalu `fileIndex[path].importance` menurun (ch. 1), lalu abjad sebagai
tiebreak terakhir. Ini secara sengaja sederhana dibandingkan bagian berikutnya —
ia hanya perlu mengurutkan file *di dalam* feature yang sudah di-scope, bukan
memutuskan file mana di seluruh proyek yang paling penting.

## `selectIndexCriticalFiles` — peringkat "mulai di sini" untuk seluruh proyek

Ini adalah yang benar-benar pertama kali diakses oleh setiap AI agent, dan merupakan
rumus peringkat paling rumit dalam codebase — layak dipahami sepenuhnya
karena ini adalah komputasi yang benar-benar berbeda dari apa pun di ch. 1 atau
ch. 6, bukan sekadar pengulangan dari mereka.

**Kandidat** dikumpulkan dari mana saja sebuah file bisa jadi penting secara masuk akal:
semua entry point, entry point dan file dari setiap feature (melewati feature
`Documentation` secara spesikan — jika tidak, ini akan membanjiri daftar ini dengan
dokumentasi, yang mendapatkan perlakuan terpisah sendiri), entry point dan langkah file dari
setiap flow, dan setiap file kritis yang sudah dihitung dari ch. 1. Pool tersebut
difilter untuk mengecualikan file bercakupan `test`/`docs`, lalu diurutkan
oleh `calculateStartHereScore()`:

```ts
return (entryIndex >= 0 ? 1_000_000 - entryIndex * 10_000 : 0)  // menjadi known entry point mendominasi semua lainnya
  + commandBonus            // +500 jika FileScope === "cli"
  + commandPathBonus        // +300 jika path match /commands?/
  + entryProximityBonus     // maks +200, menurun 60 per hop BFS dari entry point terdekat
  + flowOwnership * 120     // jumlah flow di mana file ini muncul
  + featureOwnership * 100  // jumlah feature di mana file ini merupakan entry point
  + (metadata?.featureRefs.length ?? 0) * 40
  + (metadata?.importance ?? 0);  // skor ch. 1, sebagai dorongan kecil terakhir
```

Dua hal yang perlu diperhatikan secara khusus:

- **Istilah entry-point berskala `1.000.000` bukan angka inflasi sewenang-wenang** — ia
  menjamin entry point nyata selalu diurutkan di atas semua lainnya,
  *sambil tetap mempertahankan urutan relatif mereka* (entry yang lebih awal di
  `snapshot.entryPoints` mendapat skor lebih tinggi dari yang lebih baru, melalui
  istilah `-entryIndex * 10_000`) daripada memperlakukan semua entry point sebagai
  setara.
- **`entryProximityBonus` membutuhkan BFS tersendiri**, yang dihitung oleh
  `computeEntryDistance()` — breadth-first walk dari `fileGraph` yang dimulai
  dari setiap entry point secara bersamaan. Komentar menjelaskan secara tepat mengapa
  ini ditambahkan: tanpa ini, "file yang dipanggil langsung oleh entry point"
  dan "beberapa file tiga import lebih dalam" hanya berbeda berdasarkan `importance`
  generik, yang sebenarnya tidak melacak posisi call-graph. Ini
  memperbaiki blind spot yang nyata — importance saja tidak bisa membedakan "dekat
  dengan tempat eksekusi dimulai" dari "penting tapi tersembunyi tiga level ke bawah."

## Benturan nama yang perlu dipahami dengan presisi

Ch. 1 menyebutkan `ProjectMap.agentInstructions` — objek terstruktur
(`navigationPolicy`, `maxInitialFiles`, `fallbackRule`) yang tertanam di
`snapshot.json`. `index.json` di ch. ini **juga** memiliki field bernama
`agentInstructions` — tetapi di sini ia berupa satu string prosa:

```
"Read this file first. Pick the relevant feature by keywords, open its
feature map, then inspect only source files listed in sourcePriority.
Do not read snapshot.json unless index.json and feature maps are
insufficient."
```

Ini adalah **dua field terpisah, di dua file output terpisah, dengan dua
bentuk berbeda**, yang kebetulan berbagi nama karena melayani tujuan
dasar yang sama (memberi tahu agent cara navigasi) di dua
level output yang berbeda — satu terstruktur dan machine-parseable
(`snapshot.json`), satu instruksi yang bisa langsung dibaca
(`index.json`). Jangan mengasumsikan mengedit satu akan memperbarui
yang lain.

## Pembuatan ringkasan proyek yang terbaca manusia

`createProjectSummary()`/`describeProjectKind()` mengubah array terstruktur
`projectTypes` (ch. 14 — bentuk jamak, karena deteksi framework ch. 3
bisa secara legitimate menemukan frontend dan backend dalam satu scan) menjadi
kalimat: `"DevMap is a TypeScript monorepo containing a Node.js CLI and
web application. Main capabilities: ..."`. `describeProjectKind()` menangani
satu, dua, atau banyak tipe terdeteksi dengan tata bahasa yang berbeda (`"centered on a
Node.js CLI"` untuk proyek CLI-only tunggal vs. daftar yang dipisahkan koma Oxford
untuk beberapa) — kecil, tetapi ini yang membedakan ringkasan terbaca
seperti template vs. terbaca seperti kalimat.

## Lihat juga

- Ch. 1 untuk `ProjectMap.agentInstructions`, `criticalFiles`, dan
  `fileIndex.importance` — semuanya digunakan di sini, tidak ada yang dihitung ulang di sini
- Ch. 9 untuk `fileGraph`, yang ditelusuri ulang oleh BFS `computeEntryDistance`
- Ch. 14 untuk `projectTypes`/`workspaceType` dan bagaimana snapshot.json berkaitan
  dengan apa yang ditulis ch. ini
