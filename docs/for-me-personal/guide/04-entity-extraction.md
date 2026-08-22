# 4. Entity Extraction

**Source:** `packages/cli/src/analyzers/analysis/extractors/`

Entities (`User`, `Post`, `Workspace`, ...) adalah tulang punggung yang
dibangun oleh capability detection (ch. 7), feature detection (ch. 6), dan
AI domain inference (ch. 11). Tugas utama modul ini adalah menjawab "apa
saja domain objects dari proyek ini?" — dengan gradient confidence yang
graceful ketika tidak ada ORM schema yang bisa dibaca.

## Strategy pattern, bentuk yang sama dengan analyzer cascade

Entity extraction meniru pola `AnalyzerRegistry` dari ch. 2 hampir
secara persis, hanya dengan interface-nya sendiri:

```ts
export interface IEntityExtractor {
  readonly name: string;
  canHandle(files: ScannedFile[]): boolean;
  extract(files: ScannedFile[]): EntityInfo[];
}
```

`extractEntities()` (di `extractors/index.ts`) berjalan melewati list
yang terurut, berhenti di **extractor pertama yang `canHandle()` dan
mengembalikan hasil non-kosong**:

```ts
const EXTRACTORS: IEntityExtractor[] = [
  new PrismaExtractor(),
  // new DrizzleExtractor(),   ← slot cadangan, belum diimplementasi
  // new TypeORMExtractor(),   ← slot cadangan
  // new MongooseExtractor(),  ← slot cadangan
  new SQLExtractor(),
];
```

Slot yang di-comment bukan dead code yang perlu dibersihkan — mereka
adalah extension point yang memang direncanakan. Menambahkan dukungan ORM
di kemudian hari berarti menulis satu class baru dan memasukkannya sesuai
urutan prioritas; tidak ada yang lain dalam rantai yang berubah. Urutan
mencerminkan confidence: Prisma (data field + relation lengkap dari file
schema asli) diperiksa sebelum SQL (nama tabel yang ditebak dari query
string, tanpa data field sama sekali) — ini secara spesifik memastikan
bahwa proyek yang menggunakan ORM *dan* query mentah secara berkala tidak
kehilangan data Prisma yang kaya hanya karena digantikan oleh tebakan SQL
yang lebih noisy.

Jika **semua** schema-based extractor menghasilkan kosong, ada satu level
lagi: **route-hint fallback** (`RouteFallbackExtractor`, dengan interface
`IRouteFallbackExtractor` terpisah karena input-nya adalah `RouteInfo[]`,
bukan `ScannedFile[]`) yang menebak nama entity dari URL segment. Hanya
jika itu juga tidak menemukan apa pun, `extractEntities` mengembalikan
kasus sumber kosong:

```
Prisma schema → SQL query strings → route URL segments → empty
   (high conf)      (medium conf)        (low conf)
```

Setiap `EntityInfo` membawa `source: "prisma" | "sql" | "route-hint"`
masing-masing, sehingga downstream consumer bisa memberikan bobot pada
bukti berdasarkan confidence daripada memperlakukan semua entity sama
rata.

## Tier 1 — `PrismaExtractor`

Mengurai file `.prisma` dengan parser model/field **berbasis regex** (bukan
`ts-morph` — bahasa schema Prisma bukan TypeScript). Dua regex melakukan
pekerjaan utama: satu menangkap blok `model Name { ...body... }`, yang
lainnya berjalan di setiap baris blok untuk mencari `fieldName FieldType[]?
@attrs`. Sebuah field dianggap sebagai relation ketika tipenya diawali
huruf kapital *dan* bukan salah satu dari scalar type Prisma yang dikenal
(`String`, `Int`, `DateTime`, `Json`, dll. — lihat
`PRISMA_SCALAR_TYPES`).

Prisma 5+ mendukung multi-file schema (folder `prisma/` dengan beberapa
file `.prisma`), jadi `extract()` mengurai semua file `.prisma` yang
ditemukan dan menggabungkan hasilnya — deduplikasi terjadi nanti, di
tingkat orchestrator.

### Arah relation diinferensikan, bukan dinyatakan

Schema Prisma bersifat bidirectional secara konvensi (kedua sisi relation
mendeklarasikan sebuah field), jadi extractor harus *memutuskan* arah
kanonik daripada hanya membaca satu sisi. Aturan yang diimplementasikan
di `buildRelations()`:

- Field berbentuk list (`rooms Room[]`) → `one-to-many`, entity ini adalah
  sisi "one".
- Field non-list di mana entity *lainnya* tidak memiliki field list
  balasan → `one-to-one`.
- Field non-list di mana sisi lainnya *memiliki* field list balasan → itu
  adalah sisi FK many-to-one dari relation yang sudah ditangkap dari
  sisi one-to-many entity lainnya — **dilewatkan** di sini untuk
  menghindari pengeluaran relation yang sama dua kali dari kedua arah.
- Field self-referential (`Message.sourceMessage: Message?`) dilewatkan
  sepenuhnya — valid di Prisma, tapi bukan cross-entity relationship yang
  perlu dimodelkan.

## Tier 2 — `SQLExtractor`

Untuk proyek yang menggunakan SQL client mentah (`pg`, `mysql2`,
`better-sqlite3`, dll.) tanpa ORM. Ini menghasilkan **pseudo-entity**:
hanya nama, `fields: []`, `relations: []` — tidak ada schema yang bisa
dibaca untuk tipe field, hanya nama tabel yang disebutkan dalam query
string.

Dua detail implementasi yang perlu dipahami karena ini adalah perbedaan
antara yang berjalan reliable dan yang menghasilkan sampah:

**Batas string berasal dari AST sungguhan, bukan regex.** Nama tabel
diambil dari string literal yang ditemukan melalui `ts-morph`
(`getDescendantsOfKind(SyntaxKind.StringLiteral)`), bukan pemindaian
`/"([^"]*)"/`. Komentar kode menjelaskan alasannya secara langsung: regex
pencocokan pasangan kutip yang naive memasangkan kutip ke-N dengan
ke-(N+1) tanpa memperhatikan pernyataan mana mereka berasal, sehingga
satu apostrof dalam komentar atau JSDoc (`doesn't`, `it's`) mengacaukan
paritas untuk semua yang setelahnya — diam-diam menggabungkan teks dan
kode menjadi satu "string" palsu. Node AST tidak memiliki mode kegagalan
itu: komentar dan teks JSX adalah jenis node yang sama sekali berbeda,
sehingga mereka tidak akan pernah bocor ke teks `StringLiteral`.

**Memfilter hal-hal yang *terlihat* seperti nama tabel tapi bukan.** Sebuah
literal hanya menjadi kandidat jika pertama-tama cocok dengan bentuk
pernyataan SQL (`select|insert|update|delete|with`), lalu pola
`from|into|update|join <name>`. Meskipun sudah cocok, tiga filter menolak
false positives:

- `NON_ENTITY_TABLE_NAMES` — katalog sistem Postgres/SQLite dan tabel
  pembukuan migrasi (`information_schema`, `pg_catalog`,
  `schema_migrations`, `_prisma_migrations`).
- `ENGLISH_STOPWORDS` — komentar menjelaskan filter ini diperlukan karena
  teks UI biasa ("Update your profile," "select a file from your
  computer") berada tepat di samping kata kunci SQL yang nyata; tanpa
  stopword filter, proyek yang memiliki SQL client mentah *dan* teks SaaS
  biasa akan menghasilkan entity palsu seperti `"Your"`.
- `TITLE_CASE_PATTERN` — kata yang ditangkap diawali huruf kapital
  (`DevMap`, `Stripe`) terbaca sebagai kata benda, bukan pengenal tabel
  `snake_case`/huruf kecil, jadi juga ditolak.

## Tier 3 — `RouteFallbackExtractor`

**Source:** `fallbackExtractor.ts`

Tier dengan confidence terendah: menebak nama entity dari URL segment
rute API. `/api/workspaces/[id]` → `Workspace`. Segment dinamis (`[id]`,
`[slug]`), segment ≤ 2 karakter, dan segment path non-entity yang dikenal
(`api`, `v1`, `auth`, `health`, `me`, ...) difilter terlebih dahulu.

Segment yang tersisa melalui `singularize()` — pengubah bentuk jamak
Bahasa Inggris berbasis aturan kecil (bukan library), menangani kasus
REST-pluralization yang umum sesuai urutan prioritas: peta kata tak
beraturan terlebih dahulu (`people` → `Person`, `children` → `Child`),
lalu aturan akhiran (`-ies` → `-y`, `-sses/-xes/-ches/-shes` → hapus
`-es`, `-ses` → hapus `-s`, akhiran `-s` generik → hapus). Fungsi ini
diekspor dan juga digunakan oleh `SQLExtractor` (nama tabel membutuhkan
singularisasi yang sama), jadi jika kamu sedang menyesuaikan aturan
pluralization, kedua extractor akan terpengaruh.

## Daftar relation pada entity graph diturunkan dua kali

Penting untuk diketahui jika kamu sedang memodifikasi logika relation:
**`EntityInfo.relations`** (per-entity, diisi di dalam
`PrismaExtractor.extract()` melalui `buildRelations()` sendiri) dan
**`EntityGraph.relations`** (array tingkat atas, dihitung oleh
`buildRelationGraph()` yang *terpisah* di `extractors/index.ts` dari
entity yang sudah diekstrak) adalah dua derivasi independen dari
informasi yang secara konsep sama. Mereka menggunakan logika yang sangat
mirip (`field.isRelation` + list-vs-non-list + penjaga dedup) tapi bukan
fungsi yang sama, dan kunci dedup-nya sedikit berbeda antara keduanya.
Jika sebuah relation terlihat benar di satu tapi salah di yang lain,
periksa yang mana dari keduanya yang benar-benar kamu edit.

`extractEntities()` juga mengurus deduplikasi di seluruh hasil —
`deduplicateEntities()`, yang pertama kali ditemukan menang berdasarkan
nama — yang penting secara spesifik untuk kasus multi-file schema Prisma,
di mana model yang sama secara teoritis bisa muncul jika file schema
tumpang tindih.

## Lihat juga

- Ch. 2 untuk cascade `AnalyzerRegistry` yang dicerminkan oleh struktur
  modul ini
- Ch. 7 untuk bagaimana `EntityGraph` memberi makan capability detection
- Ch. 11 untuk bagaimana `entityGraph.entityNames` dan relation memberi
  makan AI domain inference — termasuk kasus di mana pembacaan nama entity
  secara naive menghasilkan jawaban yang salah
