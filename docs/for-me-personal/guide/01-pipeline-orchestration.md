# 1. Pipeline Orchestration

**Source:** `packages/cli/src/analyzers/pipeline/projectMap.ts`

Semua yang ada di panduan ini adalah subsistem yang dipanggil `createProjectMap()`
dalam urutan tertentu. Bab ini adalah tulang punggungnya; bab-bab selanjutnya memperdalam
setiap ruasnya.

## Fungsi signature-nya adalah arsitekturnya

```ts
export async function createProjectMap(
  projectRoot: string,
  callAI?: (prompt: string) => Promise<string>
): Promise<ProjectMap>
```

`callAI` opsional, dan detail tunggal itu menjelaskan banyak hal tentang bagaimana
sisa kode sumber dibentuk:

- `createProjectMap` sendiri tidak pernah mengimpor Groq, OpenRouter, atau SDK
  provider mana pun. Ia hanya tahu tentang `(prompt: string) => Promise<string>`.
- Pemanggil (`commands/analyze.ts`) bertanggung jawab untuk membangun wrapper
  itu — meresolver config, membuat client yang tepat, mengkabelkan
  model fallback — dan memutuskan apakah akan mengirimkannya sama sekali.
- Jika `callAI` dihilangkan (tidak ada API key yang dikonfigurasi), pipeline tetap
  menghasilkan `ProjectMap` yang **lengkap**. AI domain inference adalah satu-satunya
  langkah yang dilewati; static analysis tidak pernah bergantung padanya.

Inilah pola di balik tema berulang panduan ini: static analysis adalah
fondasinya, AI hanyalah lapisan penguat opsional yang disuntikkan dari luar.

## Urutan panggilan

Dari atas ke bawah, `createProjectMap` berjalan kira-kira dalam urutan ini
(lihat source untuk nomor baris yang tepat — ini urutan dependency, bukan
urutan kode literal):

```
scanFiles(projectRoot)
  → analyzeFiles(files)                    // bab 2 — cascade TsMorph/Heuristic/Fallback
  → buildDependencyGraph(files, analyses)  // bab 9
  → countReferences(graph)
  → detectFramework(files) + detectFrameworks(files)   // bab 3
  → detectProjectMetadata(...)
  → detectEntryPoints(graph)               // bab 9
  → detectRoutes(files, frameworks, graph) // bab 3
  → detectDatabase(files)                  // bab 3

  Langkah 1: extractEntities(files, routes)                       // bab 4
  Langkah 2: detectCapabilities(routes, entityGraph)               // bab 7
  Langkah 3: detectFeatures(...) + attachFeatureEntryPoints(...)   // bab 6
  Langkah 4: inferDomain(...) jika callAI tersedia, lalu merge      // bab 11

  rankCriticalFiles(...)
  → per-file: createFileIndexEntry(...)
  → generateMinimalFlows(...)              // bab 9

  susun dan kembalikan ProjectMap
```

Empat langkah bernomor disebutkan secara eksplisit dalam komentar kode karena
mereka punya rantai dependency data yang nyata: capability membutuhkan graf entity,
fitur membutuhkan entity *dan* capability, dan domain inference membutuhkan
daftar fitur yang sudah terbentuk sempurna. Kamu tidak bisa mengubah urutannya.

### Langkah 4 lebih detail — satu-satunya langkah yang menyentuh jaringan

```ts
if (callAI) {
  const inferenceInput = buildDomainInferenceInput(
    entityGraph, capabilities, features, framework, routes.length
  );
  const result = await inferDomain(inferenceInput, callAI, projectRoot);
  if (result) {
    domain = result;
    const domainFeatures = domainFeaturesToFeatureInfo(result.domainFeatures);
    mergeDomainFeatures(features, domainFeatures);
    features.sort((a, b) => a.name.localeCompare(b.name));
  }
}
```

Perhatikan bahwa fitur yang di-infer oleh AI **tidak** ditambahkan mentah — mereka
dijalankan melalui `mergeDomainFeatures` (mesin similarity bab 8), jadi sebuah
"Customizable Plans" yang diusulkan AI dan tumpang tindih dengan "Plan Management"
yang sudah terdetekti akan digabung ke entri yang ada alih-alih membuat duplikat hampir serupa.
Array fitur diurutkan ulang setelahnya karena merge bisa mengubah
nama mana yang ada.

## Fingerprinting: bagaimana pipeline mengetahui tidak ada yang berubah

```ts
export function createProjectFingerprint(files: ScannedFile[]): string {
  const content = files
    .map((file) => [file.path, hashContent(file.content)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${path}:${hash}`)
    .join("\n");
  return hashContent(content);
}
```

Setiap file di-hash secara individual (MD5 melalui `hashContent`, lihat bab 14),
pasangan `path:hash` diurutkan berdasarkan path untuk determinisme, lalu seluruh
string yang digabung di-hash lagi menjadi satu fingerprint. Pengurutan itu penting: tanpa
itu, dua run di atas file yang sama dengan urutan enumerasi sistem file yang berbeda
akan menghasilkan fingerprint yang berbeda untuk konten yang identik.

`commands/analyze.ts` membandingkan fingerprint ini dengan fingerprint
snapshot sebelumnya sebelum melakukan sesuatu yang mahal:

```ts
if (previous.status === "valid" && previous.snapshot.fingerprint === snapshot.fingerprint) {
  // gunakan ulang snapshot yang ada — tanpa panggilan AI, tanpa re-enrichment
}
```

Inilah mekanisme yang membuat `devmap analyze` murah untuk dijalankan berulang kali:
static analysis selalu dijalankan ulang (cepat), tetapi enrichmen AI dan penulisan
snapshot dilewati setiap kali fingerprint cocok.

## Dua sistem scoring terpisah, satu signal bersama

Ini perlu disebutkan secara khusus karena mudah dicampuradukkan saat pertama kali membaca:
`projectMap.ts` menghitung pentingnya file **dua kali**, untuk dua tujuan berbeda,
dengan dua rumus berbeda.

**`rankCriticalFiles()`** menghasilkan daftar top-10 `criticalFiles` yang ditampilkan
di output CLI dan digunakan oleh onboarding:

```ts
let score = referencedBy * 3;
if (entryPointSet.has(file.path)) score += 12;
if (calculateExecutionResponsibilityBonus(file.path) > 0) score += 16; // nama file berbentuk orchestrator/router/controller, atau apa pun di commands/
if (/(types?|constants?)\.[cm]?[jt]sx?$/.test(file.path)) score -= 8;   // file types/constants jarang "kritis" untuk dibaca duluan
if (/(auth|session|db|middleware|schema|config)/i.test(file.path)) score += 3;
score += calculateCriticalSemanticBonus(file, analysis);               // 0–50, lihat di bawah
if (/(page|layout|route|server|app|main|index)\./.test(file.path)) score += 2;
```

**`calculateImportance()`** menghasilkan field `importance` (0–100, dibatasi)
yang disimpan per-file di `fileIndex`, digunakan untuk ranking di dalam fitur map
dan output agent navigation:

```ts
let importance = referencedBy * 10 + criticalScore * 5 + featureRefs.length * 8;
if (isEntryPoint) importance += 20;
if (/(index|main|app|server|layout|page|route)\./.test(path)) importance += 5;
importance += calculateSemanticImportanceBonus(...);  // 0–70, lihat di bawah
```

Kedua rumus secara independen memanggil **signal yang sama di bawahnya** —
`detectAuthenticationSemanticRole()` dari mesin fitur (dijelaskan lengkap
di bab 6) — tetapi memberi bobot sangat berbeda: versi critical-files membatasi
bonus sekitar 50, versi importance sekitar 70. Ini bukan bug;
`criticalFiles` adalah daftar top-10 pendek untuk manusia di mana kamu tidak
mau file autentikasi menyingkirkan yang lain, sementara `importance` adalah skor per-file
padat yang bertujuan untuk mengurutkan *di dalam* fitur yang seringkali
memang berat autentikasi. Jika kamu sedang men-tuning salah satunya, cek apakah yang lain
butuh penyesuaian yang cocok — mereka sengaja berbeda, tetapi bergerak menjauh secara
tidak sengaja adalah risiko yang sebenarnya.

## `classifyFileScope` — tag per-file yang lain

Terpisah dari importance, setiap file mendapat `FileScope`
kasar (`api | ui | database | config | service | cli | test | docs | unknown`),
dihitung oleh `classifyFileScope()` menggunakan path dan regex nama export yang ringan
(misalnya apa pun di bawah `commands?/cli/bin/scripts?/console/` → `"cli"`; nama export
yang cocok dengan `GET|POST|PUT|...` → `"api"`). Ini sengaja lebih sederhana
dari classifier `FileRole` di bab 2 — `FileScope` ada untuk filtering tingkat atas
(misalnya "kecualikan file docs dan test dari kandidat agent navigation"),
bukan untuk dokumentasi arsitektural.

## Menyusun `ProjectMap`

Nilai kembalian adalah tipe paling penting di seluruh kode sumber — setiap
perintah, setiap file yang dihasilkan, pada akhirnya membaca dari `ProjectMap`. Beberapa
hal yang perlu diketahui tentang bagaimana ia dibentuk:

- Field opsional (`database`, `entityGraph`, `capabilities`, `domain`,
  `warnings`) dilampirkan dengan spread bersyarat
  (`...(database ? { database } : {})`) alih-alih selalu hadir sebagai
  `null`/`undefined` — ini menjaga `.devmap/snapshot.json` dan output `--json`
  tetap ringan ketika sebuah proyek benar-benar tidak punya database atau tidak terdeteksi
  capability-nya.
- `agentInstructions` adalah objek kecil, hardcoded yang di bake ke *setiap*
  snapshot: `navigationPolicy: "index-first"`, `maxInitialFiles: 3`,
  `fallbackRule: "..."`. Ini adalah bagian yang dibaca mesin dari kontrak yang sama
  yang dinyatakan `AGENTS.md` dalam prosa (bab 13) — artinya sebuah agent
  yang hanya membaca `snapshot.json` langsung (melewati `AGENTS.md`
  sepenuhnya) tetap mendapatkan kontrak navigasi.
- `dependencies` (nama package npm dari `package.json`) dan `fileGraph`
  (impor file-to-file yang sudah diresolusi) adalah field terpisah yang sengaja
  berbeda dengan nama yang terdengar mirip — jangan campuradukkan saat membaca kode downstream.

## Lihat juga

- Bab 2 untuk apa yang `scanFiles` dan `analyzeFiles` benar-benar lakukan
- Bab 6 untuk mekanisme `detectAuthenticationSemanticRole` lengkap yang dirujuk
  dua kali di atas
- Bab 9 untuk `buildDependencyGraph`, `detectEntryPoints`, dan generasi flow
- Bab 14 untuk `hashContent` (MD5) dan bagaimana fingerprint memberi makan pengecekan
  stale snapshot di tempat lain di CLI