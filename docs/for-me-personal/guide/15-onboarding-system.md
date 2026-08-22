# 15. Onboarding System

**Source:** `packages/cli/src/onboarding/`

Ini adalah ch. sistem terakhir, dan ini adalah jenis modul yang berbeda dari
empat belas ch. sebelumnya: **nol panggilan AI, nol analisis baru** — semuanya
di sini beroperasi pada `ProjectMap` yang sudah lengkap dan mengubahnya menjadi
narasi proyek yang terbaca manusia, secara bilingual. Perintah `devmap onboarding`
*yang mengekspos ini* didokumentasikan secara terpisah di
[`commands/03-onboarding.md`](./commands/03-onboarding.md) — ch. ini
hanya logika pembangun model di baliknya.

## `model.ts` adalah murni bentuk, tidak lebih

```ts
export interface OnboardingModel {
  language: OnboardingLanguage;   // "en" | "id"
  projectName: string;
  tagline: string;
  stackLine: string;
  whatThisIs: string;
  howItWorks: ConceptualStep[];
  features: FeatureSummary[];
  startHere: StartHereItem[];
  generatedAt: string;
  isStale: boolean;
}
```

Tidak ada fungsi di file ini — file ini ada semata-mata agar `modelBuilder.ts` dan
`commands/onboarding.ts` berbagi satu kontrak tanpa salah satunya menguasainya.

## `buildOnboardingModel()` — satu titik masuk

Semua yang lain di `modelBuilder.ts` adalah helper privat yang memberi makan ke
satu fungsi ini, setiap field dibangun secara independen dari potongan snapshot
yang berbeda:

```ts
export function buildOnboardingModel(snapshot: ProjectMap, language: OnboardingLanguage): OnboardingModel {
  return {
    language,
    projectName: snapshot.project.name || "project",
    tagline: buildTagline(snapshot, language),
    stackLine: buildStackLine(snapshot),
    whatThisIs: buildWhatThisIs(snapshot, language),
    howItWorks: buildHowItWorks(snapshot, language),
    features: buildFeatureSummaries(snapshot, language),
    startHere: buildStartHere(snapshot, language),
    generatedAt: snapshot.generatedAt,
    isStale: false,
  };
}
```

Setiap helper `build*` di bawah ini secara internal bercabang berdasarkan `language`
— ini bukan lapisan terjemahan yang ditambahkan di belakang; narasi Indonesia dan
Inggris dibangun sebagai dua pohon template yang benar-benar terpisah
di dalam fungsi yang sama, per kalimat.

## `resolveOwnershipHint()` — perlindungan ch. 11, digunakan ulang untuk narasi alih-alih inferensi

`buildTagline()` mengandalkan `snapshot.domain.ownershipPattern` — field
yang persis sama yang dihitung oleh domain inference ch. 11 untuk bukti struktural —
tetapi untuk tujuan yang berbeda di sini: bukan mengarahkan prompt AI dari
kesimpulan yang salah, tetapi secara langsung memilih salah satu dari tiga template tagline
("Personal app…", "Direct messaging platform…", "Collaborative app…")
untuk di-render. Klasifikasi `single_user_isolated` yang sama yang menghentikan AI
dari berlebihan menyebut sesuatu "chat" di ch. 11 adalah yang membuat tagline
onboarding secara benar mengatakan **"Personal app"** alih-alih menebak dari
nama entity.

## `buildWhatThisIs()` — baris pertahanan kedua, independen, terhadap false positive yang sama

Ini layak dibaca dengan seksama karena ini adalah callback yang benar-benar elegan
ke contoh unggulan ch. 11, yang diterapkan di level berbeda:

```ts
const hasMisleadingChat = entityNames.includes("Message") && domainPattern === "single_user_isolated";
if (hasMisleadingChat) {
  const roomEntity = entityNames.find((e) === "Room" || e === "Channel" || e === "Thread");
  if (roomEntity) {
    sentences.push(
      language === "id"
        ? `"${roomEntity}" adalah wadah (seperti folder), dan "Message" adalah isinya — bukan komunikasi antar user.`
        : `"${roomEntity}" acts as a container (like a folder), and "Message" is its content — not inter-user communication.`
    );
  }
}
```

Bahkan *setelah* domain inference sudah secara benar menghindari menyebut proyek
ini "chat" (ch. 11), manusia yang membaca `Message`/`Room` di daftar
entity bisa saja tetap membentuk kesan yang salah. Kode ini menambahkan
kalimat penjelasan eksplisit khusus untuk pembaca tersebut — kekhawatiran
dasar yang sama (nama entity yang mengimplikasi komunikasi multi-user yang
sebenarnya tidak ada) ditangani dua sekali, sekali untuk menjaga AI dari
pernyataan yang salah, sekali untuk menjaga manusia dari pemahaman yang salah.

## `buildHowItWorks()` — empat template narasi, bukan satu isian kosong

Alih-alih satu paragraf "cara kerja" generik, ini mendispatch ke
salah satu dari empat **rangkaian langkah yang sepenuhnya terpisah** berdasarkan bentuk proyek:

```ts
if (isCli) return buildCliFlow(...);
if (hasAuth && hasRoutes) return buildAuthWebAppFlow(...);
if (hasRoutes) return buildPublicWebAppFlow(...);
return buildGenericFlow(...);
```

`buildAuthWebAppFlow` adalah yang paling detail — ia bercabang lebih lanjut berdasarkan
`ownershipPattern` untuk salah satu langkahnya ("semua data dimiliki oleh user
yang login" vs. "data bisa dibagikan antar user") dan menyebut entity nyata
(mengecualikan infra — `User`, `Session`, `Account`,
`VerificationToken`) yang ditarik dari `entityGraph`. Proyek CLI tidak pernah melihat
bahasa "user login"; proyek berbentuk library tanpa route jatuh ke
template generik empat langkah. Ini adalah decision tree nyata yang disesuaikan
dengan bentuk proyek, bukan string interpolation ke satu paragraf tetap.

## `isBoilerplatePurpose()` — satu lagi pengecekan "apakah teks ini generik"

```ts
function isBoilerplatePurpose(purpose: string): boolean {
  return /\b(exposes|contains project code|identifies .* capability|detected as)\b/i.test(purpose);
}
```

`buildFeatureWhat()` menggunakan ini untuk memutuskan apakah string `purpose` yang
sudah ada dari sebuah feature layak dikutip langsung di narasi onboarding, atau
apakah sebaiknya jatuh ke kalimat `"Handles X for the project."` yang
di-generate. Secara konseptual ini adalah masalah yang sama dengan yang diselesaikan
`isGenericPurpose()` ch. 8 untuk keputusan feature-merge — **tetapi ini adalah
fungsi terpisah dengan regex terpisah**, bukan import bersama. Jika jenis baru
purpose generik auto-generated diperkenalkan di tempat lain dalam
pipeline, kedua pengecekan ini perlu diperbarui secara independen agar
perilaku "jangan kutip teks generik seolah-olah itu spesifik" tetap
konsisten di mana pun hal itu penting.

## `buildStartHere()` — peringkat "apa yang harus dibaca duluan" independen ketiga

Ini adalah detail yang paling layak diinternalisasi dari ch. ini, karena
mudah mengasumsikan ada satu daftar "file kritis" kanonik di DevMap
padahal sebenarnya ada **tiga**, masing-masing menjawab pertanyaan yang terkait tetapi berbeda:

| Peringkat | Hidup di | Menjawab | Output |
|---|---|---|---|
| `rankCriticalFiles()` | ch. 1 | "Apa 10 file yang paling penting secara struktural dari proyek ini?" | `snapshot.criticalFiles`, ditampilkan di output CLI |
| `selectIndexCriticalFiles()` | ch. 13 | "Dalam urutan apa seorang AI agent harus membuka file, secara global?" | `sourcePriority` di `index.json` |
| `buildStartHere()` | ch. ini | "Apa urutan baca yang baik yang **dinarasikan dan beralasan** untuk manusia yang baru bergabung dengan proyek ini?" | `onboarding.startHere`, setiap entri dengan **alasan prosa**, bukan sekadar skor |

`buildStartHere()` memulai daftarnya dari urutan yang secara sengaja dikurasi dan
diurutkan alih-alih satu formula skoring: entry point feature `Authentication`
terlebih dahulu (jika ada — "pahami siapa yang bisa mengakses apa sebelum membaca
apa pun"), lalu file schema Prisma jika ada,
lalu dua entry point global pertama, lalu satu entry point per
feature dengan confidence tinggi/sedang (mengecualikan Authentication, yang sudah ditambahkan),
lalu sisa `criticalFiles` dengan alasan yang diturunkan dari
**`REASON_TAGS`** (tag `CORE_EXECUTION_RESPONSIBILITY`/
`CORE_PROJECT_CONCERN` ch. 1, digunakan ulang langsung di sini via
`buildCriticalFileReason()`), lalu terakhir apa pun yang tersisa di
`onboarding.recommendedPath` (ch. 9) yang belum disertakan. `Map` yang di-key
berdasarkan path melakukan dedup di seluruh semua sumber ini, yang ditambahkan
pertama menang.

Jika kamu diminta mengubah "file apa yang harus dibaca oleh pendatang baru terlebih dahulu,"
jawaban yang jujur adalah: cari tahu salah satu dari ketiga fungsi ini yang benar-benar
menghasilkan output yang kamu lihat, karena memperbaiki satu tidak akan mempengaruhi
dua lainnya.

## `isReadableSourceFile()` — filter pengecualian keempat, dengan cakupan sempit

Satu lagi implementasi independen kecil yang perlu ditandai dalam tema
yang sama dengan `classifyFileTier` ch. 6: `isReadableSourceFile()` mengecualikan
migrasi, file `.sql`, kode yang di-generate, lockfile, dan gambar dari pernah
muncul di `startHere` — secara konseptual pengecualian yang sama dengan yang diterapkan
`classifyFileTier` melalui tier `"excluded"`-nya, tetapi diimplementasi sebagai daftar
regex tersendiri di sini alih-alih memanggil fungsi tersebut. Output onboarding hanya
membutuhkan filter ya/tidak, bukan klasifikasi empat tier yang dibutuhkan
feature engine, jadi duplikat yang lebih ringan ditulis alih-alang mengimpor
yang lebih berat.

## Lihat juga

- Ch. 11 untuk `ownershipPattern` dan ambiguitas chat/personal-app asli
  yang di-echo oleh pengecekan `hasMisleadingChat` ch. ini
- Ch. 1 untuk `REASON_TAGS` dan `rankCriticalFiles`, yang pertama dari tiga
  peringkat "mulai di sini"
- Ch. 13 untuk `selectIndexCriticalFiles`, yang kedua
- Ch. 8 untuk `isGenericPurpose`, saudara dari `isBoilerplatePurpose`
  ch. ini
- [`commands/03-onboarding.md`](./commands/03-onboarding.md) untuk bagaimana model
  ini benar-benar di-render dan ditulis ke disk oleh perintah CLI
