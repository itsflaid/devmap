# 11. AI Domain Inference

**Source:** `packages/cli/src/analyzers/inference/`

Ini adalah Step 4 dari `createProjectMap` (chapter 1) — satu-satunya
titik di seluruh pipeline yang menyentuh jaringan. Ini juga chapter
dengan contoh paling jelas tentang *mengapa* DevMap memperlakukan AI
sebagai peningkatan yang hati-hati dan terbatasi oleh evidence, bukan
sesuatu yang dipercaya untuk bernalar bebas: versi naive dari fitur ini
menghasilkan kelas pertanyaan yang spesifik dan bisa diprediksi secara
salah, dan implementasi yang ada saat ini bertujuan mencegah hal tersebut
persis.

## Masalah: nama entity saja tidak cukup untuk domain

Prompt `inferDomain()` hanya mengirim **metadata terstruktur** — tidak
pernah source code mentah. Komentar dokumen secara eksplisit menjelaskan
mengapa:

> Secara sengaja tidak mengirim source code mentah — hanya metadata
> terstruktur. Ini menjaga penggunaan token tetap minimal (~300–500 token
> per panggilan) dan memastikan AI berfokus pada inferensi domain, bukan
> analisis kode.

Tapi metadata terstruktur saja punya mode kegagalan yang spesifik. Entity
 bernama `Message`, yang berelasi dengan entity bernama `Room`, terlihat
— oleh model yang bernalar dari nama saja — persis seperti aplikasi chat.
Bisa juga itu aplikasi jurnal pribadi di mana "Room" berarti "notebook"
dan "Message" berarti "entry." Nama *entity* tidak membawa perbedaan itu;
**relasi dan kepemilikan entity** lah yang membawanya.

## Topologi kepemilikan: bukti struktural yang benar-benar membedakan kasus ini

**Source:** `ownershipTopology.ts`

`classifyOwnershipTopology()` melihat *bentuk* dari entity graph, bukan
labelnya, dan mengklasifikasikannya ke dalam salah satu dari empat pola:

```ts
export type OwnershipPattern =
  | "single_user_isolated" | "shared_access" | "direct_messaging" | "unclear";
```

Sinyal yang dicari:

- **Nama field lintas-user** — daftar hardcode (`participants`, `members`,
  `sharedWith`, `recipientId`, `senderId`, `collaborators`, `inviteeId`,
  ...) diperiksa terhadap nama field setiap entity, dinormalisasi untuk
  menghapus case/tanda baca sebelum perbandingan.
- **Relasi many-to-many yang menyentuh `User`** — sinyal struktural
  langsung untuk akses bersama, independen dari konvensi penamaan field
  apa pun.
- **Beberapa foreign key ke `User` di entity yang sama** — entity dengan
  dua atau lebih field yang beruffix `*Id` dan namanya tumpang tindih
  dengan `"user"` adalah petunjuk kuat untuk relasi *antara* user (satu
  FK untuk "siapa yang mengirim," satu untuk "siapa yang menerima")
  bukan satu pemilik. Jika salah satu nama FK tersebut secara spesifik
  mengandung `sender`/`recipient`, itu mendorong klasifikasi ke
  `direct_messaging` secara spesifik.

Pola yang dihasilkan ditentukan oleh cascade prioritas: bukti
direct-messaging + field lintas-user → `direct_messaging`; any
many-to-many-with-User atau field lintas-user sendirian → `shared_access`;
beberapa entity dengan **tidak ada** dari hal-hal di atas →
`single_user_isolated`; yang lainnya → `unclear`. Ini persis jenis hal
yang skema `Message`/`Room` dengan **tidak ada** perpecahan sender/recipient
dan **tidak ada** relasi many-to-many-with-User akan diklasifikasikan
sebagai `single_user_isolated` — mengidentifikasinya dengan benar sebagai
alat pribadi, terlepas dari bagaimana nama entity kebetulan.

## Safeguard eksplisit dari prompt

**Source:** `buildDomainInferencePrompt()`

Bukti struktural ini hanya membantu jika model benar-benar diberitahu
untuk memberinya bobot lebih dari penamaan. Bagian aturan dari prompt
menyatakannya secara langsung — ini mendekati teks prompt yang harfiah,
karena instruksi itu sendiri adalah artefak penting di sini:

> Nama entity saja (misalnya `Message`, `Room`, `User`) bukan sinyal
> yang dapat diandalkan untuk domain aplikasi. Nama entity yang sama bisa
> merepresentasikan pesan chat, log aktivitas, catatan pribadi, atau
> komentar — tergantung pola kepemilikan, bukan penamaan. Gunakan
> `ownershipPattern` dan `absentCapabilities` sebagai bukti utama:
> `single_user_isolated` sangat menunjukkan alat pribadi/privat, bukan
> platform komunikasi multi-user. Hanya menyimpulkan domain "chat" atau
> "messaging" jika `ownershipPattern` adalah `shared_access` atau
> `direct_messaging`, atau kemampuan yang terdeteksi mencakup
> kolaborasi/sosial/real-time.

`absentCapabilities` — sisi berlawanan dari daftar `CapabilityInfo`
chapter 7 — dihitung dengan membandingkan set lengkap jenis capability
yang diketahui dengan yang benar-benar terdeteksi
(`buildDomainInferenceInput()`). Memberi tahu model tentang apa yang
*tidak ditemukan* (tidak ada route berbagi, tidak ada transport real-time,
tidak ada endpoint kolaborasi) disengaja diberikan sebagai bukti dengan
status yang sama dengan apa yang *ditemukan* — ketiadaan infrastruktur
multi-user diperlakukan sebagai sinyal nyata yang bisa dikutip, bukan
hanya celah di input.

## Caching: SHA-256, dan mengapa ini ada secara khusus untuk stabilitas

**Source:** fungsi cache di bagian atas `domainInference.ts`

Setiap panggilan di-cache ke `.devmap/domain-cache.json`, dengan kunci
hash dari seluruh `DomainInferenceInput` — nama entity, relasi,
capability, nama feature teknis, jumlah route, framework, pola
kepemilikan, field lintas-user, dan capability yang absen, semuanya
diurutkan sebelum hashing sehingga urutan kunci tidak pernah mempengaruhi
hasil:

```ts
function hashDomainInput(input: DomainInferenceInput): string {
  const stable = JSON.stringify({ v: 2, /* ...sorted fields... */ });
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}
```

Ini adalah **algoritma hash yang berbeda** dari MD5 `hashContent()` yang
digunakan untuk fingerprint seluruh project (chapter 1, chapter 14) —
layak diketahui bahwa ini dua mekanisme terpisah untuk dua tujuan
terpisah, bukan satu utilitas bersama. Field `v: 2` adalah versi skema
yang di bake langsung ke dalam payload yang di-hash: jika bentuk
`DomainInferenceInput` berubah, tingkatkan angka tersebut dan setiap entri
cache yang ada secara alami miss (hash berbeda untuk data yang sama)
daripada dibaca dengan bentuk yang sudah usang.

Komentar menyatakan motivasi yang sebenarnya secara jelas:

> Ini memastikan `devmap analyze` bersifat idempotent — nama feature tidak
> berubah di setiap run selama codebase belum berubah.

Tanpa cache ini, menjalankan ulang `devmap analyze` di project yang tidak
berubah bisa menghasilkan ringkasan domain atau daftar feature dengan
*rumusan berbeda* setiap kali (LLM tidak deterministik bahkan di suhu
rendah), yang akan membingungkan — sinyal "apakah sesuatu berubah?" tanpa
perubahan nyata di baliknya. Cache hit melewati panggilan LLM sepenuhnya,
jadi project yang tidak berubah tidak akan pernah memanggil ulang AI
setelah `analyze` pertama, tidak peduli berapa kali kamu menjalankannya.
Tulisan cache secara eksplisit best-effort — kegagalan tulisan ditelan
secara diam-diam daripada membatalkan analisis, karena cache adalah
optimasi stabilitas, bukan persyaratan kebenaran.

## Kegagalan selalu `null`, tidak pernah error yang dilempar ke atas

`inferDomain()` membungkus seluruh panggilan dalam `try/catch` yang
mengembalikan `null` pada kegagalan apa pun — respons AI yang salah
format, error jaringan, JSON yang tidak bisa di-parse. Komentar dokumen:
*"AI inference adalah peningkatan, bukan penghalang. Jika gagal, kembalikan
null — pemanggil masih punya fitur statis."* Ini adalah postur
graceful-degradation yang sama yang dideskripsikan chapter 1 di tingkat
pipeline, diimplementasikan secara konkret di sini: Step 4 `createProjectMap`
hanya memeriksa `if (result)` sebelum melakukan apa pun dengannya.

`parseDomainInferenceResponse()` juga secara sengaja defensif dari awal —
ini menghapus code fence markdown yang mungkin dibungkus model di JSON
meskipun sudah diberitahu untuk tidak melakukannya, dan setiap akses field
menggunakan optional chain dengan fallback, jadi respons yang sebagian
salah format degradasi ke `null` daripada melempar error di tengah
parsing.

## Memberi makan hasil kembali ke daftar feature

`domainFeaturesToFeatureInfo()` mengkonversi setiap feature yang
disarankan AI menjadi `FeatureInfo` dengan satu detail yang disengaja:
`searchTerms` menyertakan `relatedEntities` yang disediakan AI, dalam
huruf kecil. Komentar menjelaskan secara persis mengapa field ini diisi
dengan cara ini — ini yang memungkinkan mesin similarity chapter 8 benar-
benar mengenali overlap:

```ts
// AI returns relatedEntities: ["Plan", "Subscription"]
// Static feature "Plan Management" has searchTerms: ["plan", "subscription", ...]
// → entityOverlap / termOverlap high → merged, not duplicated.
```

Feature yang di-infer AI selalu ditetapkan `confidence: "medium"` — tidak
pernah `"high"` — terlepas dari seberapa yakin field `confidence` model
klaim; field tersebut di-parse dan di-clamp ke
`DomainInferenceResult.confidence` tapi bukan yang menentukan level
confidence dari feature yang sudah di-merge.

## Lihat juga

- Chapter 1 untuk lokasi pasti Step 4 di urutan `createProjectMap`
- Chapter 7 untuk `CapabilityInfo`/`CapabilityKind`, sumber
  `absentCapabilities`
- Chapter 8 untuk `mergeDomainFeatures`, yang mengkonsumsi output
  chapter ini
- Chapter 14 untuk perbedaan MD5 vs SHA-256 di berbagai cache codebase
