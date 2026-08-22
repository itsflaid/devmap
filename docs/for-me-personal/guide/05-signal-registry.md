# 5. Signal Registry

**Source:** `packages/cli/src/analyzers/registry/`

Tiga consumer yang terlihat tidak berhubungan — feature detection (ch. 6),
external service detection (ch. 3), dan AI-provider detection (konteks
ch. 12 seputar Groq/OpenRouter) — semuanya membaca dari **data dasar yang
sama**. Data itu disimpan di sini, satu `SignalDescriptor` per topik,
dibagi ke dalam file per-domain (`auth.ts`, `payments.ts`, `search.ts`,
`ai-providers.ts`, 17 file total) dan digabungkan oleh `index.ts`.

Bab ini sengaja pendek — ini sebagian besar peta dari strukturnya, karena
menambahkan atau mengedit signal adalah salah satu kontribusi kecil yang
paling sering diajak dalam codebase ini.

## Satu bentuk descriptor, tiga kategori

```ts
export type SignalCategory = "feature" | "provider" | "ai-provider";

export type SignalDescriptor = {
  name: string;
  category: SignalCategory;
  purpose?: string;
  genericTerms?: string[];        // kata kunci yang digunakan untuk feature matching
  importNames?: string[];         // nama paket yang persis, mis. "stripe"
  importPrefixes?: string[];      // awalan nama paket, mis. "@langchain/"
  contentSignals?: string[];      // string literal untuk dicari di konten file
  hosts?: string[];               // nama host, mis. "api.groq.com"
  importOnly?: true;              // lihat di bawah
  minimumDistinctFiles?: number;  // lihat di bawah
};
```

Satu domain biasanya mendeklarasikan **dua** descriptor: satu entri
`category: "feature"` (luas, berbasis kata kunci — "proyek ini punya
pembayaran entah bagaimana") dan satu atau lebih entri
`category: "provider"`/"`ai-provider`" (spesifik, berbasis identitas
paket — "secara spesifik Stripe"). `payments.ts` adalah contoh yang jelas:

```ts
export const DESCRIPTORS: SignalDescriptor[] = [
  { name: "Payments", category: "feature", genericTerms: [
      "stripe", "midtrans", "xendit", "paypal", "braintree", "razorpay",
      "payment", "checkout", "billing", "subscription", "invoice",
    ], purpose: "Handles payment providers, billing, and transaction workflows." },
  { name: "Stripe", category: "provider", importNames: ["stripe"] },
  { name: "Midtrans", category: "provider", importNames: ["midtrans"] },
];
```

## Dua flag yang perlu dipahami sebelum menambahkan signal

**`importOnly: true`** — digunakan pada `AI Integration`. Ini memberitahu
feature engine (ch. 6) bahwa pencocokan kata kunci dalam teks (komentar,
string, markdown) tidak dihitung sebagai bukti untuk fitur ini; hanya
import paket sungguhan yang dihitung. Tanpa ini, judul
`# AI Integration roadmap` di README akan diperlakukan sama dengan
`import OpenAI from "openai"` yang nyata — `importOnly` ada secara
khusus untuk mencegah jenis false positive tersebut pada topik yang orang
tulis *tentang* jauh lebih sering daripada yang mereka import.

**`minimumDistinctFiles`** — digunakan pada `Search` (`minimumDistinctFiles:
2`). Membutuhkan bukti muncul di setidaknya N file berbeda sebelum fitur
dianggap terdeteksi sama sekali. `Search` membutuhkan ini karena kata
"search" cukup umum dalam teks UI biasa (satu `<input
placeholder="Search...">`) sehingga satu kecocokan adalah bukti yang
lemah; dua atau lebih file secara independen merujuk istilah terkait
pencarian adalah sinyal yang jauh lebih kuat. Ini adalah kerabat yang
lebih kasar dan tahap awal dari confidence *thresholds* yang digunakan
oleh capability detection (ch. 7) — kekhawatiran dasar yang sama (satu
kecocokan kebetulan ≠ kemampuan sungguhan), subsistem yang berbeda.

## `index.ts` — satu list, empat view turunan

`REGISTRY_DESCRIPTORS` adalah konkatan datar dari ekspor `DESCRIPTORS`
setiap file domain. Semua hal lainnya di `index.ts` adalah **view turunan**
yang dihitung sekali saat modul dimuat:

- **`FEATURE_SIGNALS`** — setiap descriptor `category: "feature"`,
  dibentuk ulang menjadi tipe `FeatureSignal` yang benar-benar dikonsumsi
  oleh feature engine (`{ name, terms, purpose, importOnly?,
  minimumDistinctFiles? }`). Ini adalah seluruh input untuk pencocokan
  fitur berbasis kata kunci di ch. 6 — tidak ada daftar feature-signal
  terpisah yang dipertahankan di tempat lain.
- **`SERVICES`** — untuk setiap nama dalam daftar hardcode
  `SERVICE_NAMES` (`Prisma`, `Supabase`, `Stripe`, `NextAuth`, `Midtrans`,
  `Resend`, `Cloudinary`, `Firebase`, `OpenAI`, `Groq`, `OpenRouter`),
  cari descriptor `provider`/`ai-provider`-nya dan ambil `importNames`.
  Digunakan oleh `serviceDetector.ts` (ch. 3) sebagai
  `Array<[needleList, serviceName]>`. Perhatikan `requireProviderDescriptor()`
  **melempar error** jika nama di `SERVICE_NAMES` tidak resolve ke
  descriptor yang memiliki `importNames` — ini adalah fail-fast yang
  disengaja: berarti menambahkan nama ke `SERVICE_NAMES` tanpa juga
  memberikan provider tersebut array `importNames` akan merusak build
  secara langsung, daripada diam-diam tidak mendeteksi apa pun saat
  runtime.
- **`SOURCE_SERVICE_SIGNALS`** — daftar `SERVICE_NAMES` yang sama, tapi
  mengambil `contentSignals` alih-alih `importNames`, untuk layanan yang
  dideteksi dengan memindai *konten* file (mis. string `api.groq.com`
  yang di-hardcode) alih-alih dependensi yang dideklarasikan. Hanya
  provider yang benar-benar mendeklarasikan `contentSignals` yang muncul
  di sini — `flatMap` dengan short-circuit array kosong melewati sisanya.
- **`isAiProviderImport()` / `hasAiProviderUrl()`** — dibangun dari
  `importNames`/`importPrefixes`/`hosts` setiap descriptor
  `category: "ai-provider"`, dideduplikasi menjadi set datar. Dua fungsi
  inilah yang memungkinkan feature engine (ch. 6) dan capability detection
  bertanya "apakah ini secara spesifik integrasi AI provider?" tanpa
  keduanya memiliki daftar provider duplikat.

## Menambahkan signal baru

Dengan pola di atas, menambahkan dukungan untuk payment provider baru,
misalnya, hampir selalu perubahan dua baris di satu file yang sudah ada —
tanpa file baru, tanpa perubahan ke `index.ts`, tanpa perubahan ke
detector mana pun:

```ts
// payments.ts
{ name: "LemonSqueezy", category: "provider", importNames: ["@lemonsqueezy/lemonsqueezy.js"] },
```

...plus menambahkan kata kunci provider ke deskripsi feature `"Payments"`
saudaranya di `genericTerms` jika kamu ingin sebutan teks/komentar juga
dihitung ke sinyal fitur yang lebih luas "proyek ini punya pembayaran".

Satu *domain* yang benar-benar baru (bukan provider baru dalam domain
yang sudah ada) adalah satu-satunya kasus yang membutuhkan file baru:
buat `my-domain.ts` dengan mengikuti bentuk ekspor `DESCRIPTORS:
SignalDescriptor[]` yang sama, lalu tambahkan satu baris import dan satu
baris spread ke `REGISTRY_DESCRIPTORS` di `index.ts`.

## Lihat juga

- Ch. 6 untuk detail bagaimana `FEATURE_SIGNALS` dicocokkan dengan file
- Ch. 3 untuk bagaimana `SERVICES` / `SOURCE_SERVICE_SIGNALS` memberi
  makan `detectExternalServices()`
- Ch. 7 untuk pola threshold-tuning (terpisah) milik capability detection
