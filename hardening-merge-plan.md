# Hardening Merge — Execution Plan (Revised)

Branch: `hardening-merge`

## Status Progress

| Step | Status | Session |
|------|--------|---------|
| 1. featureSimilarity.ts — Config + explainability | ✅ Done | Session 1 |
| 2. featureDetector.ts — Entity files populate | ✅ Done | Session 1 |
| 3. featureMerge.ts — Fingerprint + safety fixes | ✅ Done | Session 1 |
| 4. projectMap.ts — Confidence boost fix | ✅ Done | Session 2 |
| 5. featureDetector.ts — Signal fixes | ✅ Done | Session 2 |
| 6. domainInference.ts — Medium confidence | ✅ Done | Session 2 |
| 7. featureDetector.ts — Regex pre-compile | ✅ Done | Session 2 |
| 8. Unit test baru (22 skenario) | ✅ Done | Session 2 |
| 9. Regresi + type check | ✅ Done | Session 2 |

## Tujuan

Merge system baru (featureSimilarity + featureMerge) sudah jalan, tapi belum bisa
dipercaya. Hardening ini memastikan pipeline input→similarity→merge→output konsisten
dan tidak silent wrong — no false positives, no data loss, no confidence ngaco.

Bukan nambah fitur baru. Murni correctness + reliability.

---

## Dependency Kritis (baca dulu sebelum eksekusi)

**Fix #2 (entity files) adalah hard prerequisite untuk merge correctness.**

Entity features dari `entityGraphToFeatures` start dengan `files: []`.
Similarity engine pakai fileOverlap weight 0.45 (paling gede).
Kalau files kosong → fileOverlap = 0 → merge score bias bawah → duplicate.
Jadi: fix entity files HARUS selesai sebelum merge behavior bisa dipercaya.

---

## Pre-step: Settle `MAX_SEARCH_TERMS` Konstanta

✅ **Selesai di Session 1.**

- Nilai: **8** (konsisten dengan featureDetector yang sudah ada)
- Location: define di `featureSimilarity.ts:26`, export
- Nama: `MAX_SEARCH_TERMS = 8`

Ini cross-cutting — kalau nggak settled dulu, unit test #13 akan salah assertion.

---

## Urutan Eksekusi (Revised)

### 1. `featureSimilarity.ts` — Extract config + explainability ✅

**Config extraction** ✅
- Pindah `WEIGHTS` dan `DEFAULT_SIMILARITY_THRESHOLD` ke type `FeatureSimilarityConfig`
- Export `DEFAULT_SIMILARITY_CONFIG` sebagai default
- `computeSimilarity`, `isSimilarFeature`, `findSimilarFeature` accept optional `config?`
- Export `MAX_SEARCH_TERMS = 8` dari sini

**Explainability** _(internal debugging only — jangan expose ke public API dulu)_ ✅
- Type baru: `SimilarityExplanation` — breakdown per faktor + reasons + weaknesses
- Fungsi baru: `computeSimilarityWithExplanation(a, b, config?)`
- Mark sebagai `@internal` — kandidat masuk `devmap doctor` output nanti, bukan public

**Fingerprint integration**
- `buildFeatureFingerprint` sudah ada
- Integrasi ke `featureMerge.ts` di step berikutnya ✅ (Step 3)

---

### 2. `featureDetector.ts` — Populate entity feature evidence (Hard prerequisite) ✅

**`entityGraphToFeatures` — selesai:**
- Fungsi sekarang terima `files: ScannedFile[]` parameter tambahan
- Scan file paths untuk match entity name (case-insensitive, path segment match)
- Entity features sekarang punya `files` + `evidence` → fileOverlap di similarity bisa kerja

**Catatan**: `detectFeatures()` pass `scopedFiles` ke `entityGraphToFeatures`.

---

### 3. `featureMerge.ts` — Fingerprint integration + safety fixes ✅

**Fingerprint integration** ✅
- `toFeatureIdentity` sekarang pakai `buildFeatureFingerprint` untuk normalize identity

**`extractRelatedEntities` (L62)** ✅
- Filter: hanya Title Case terms yang match entity name pattern
- Fallback ke pattern `^(.+?) (?:Management|System|...)` jika tidak ada entityGraph match

**`mergeFeatureData` (L129)** ✅
- `purpose`: existing wins KECUALI existing generic fallback string → pakai addition
- `businessFlow`: existing wins jika non-empty DAN bukan placeholder → fallback ke addition
- `entryPoints`: union (bukan existing-only)
- `confidence`: jangan downgrade — `higherConfidence` sudah benar
- `searchTerms`: cap di `MAX_SEARCH_TERMS` (8), bukan 12

---

### 4. `projectMap.ts` — Confidence boost fix

**`attachFeatureEntryPoints` (L630)**
- Sekarang: `files.length >= 2 || relatedEntries.length > 0 ? "high" : feature.confidence`
- Masalah: 2 file random dari fallback analyzer = high
- Fix: confidence boost hanya kalau minimal 1 evidence file punya `analysisConfidence: "high"`
  di `fileIndex` / `analyses`
- Logic baru (pseudocode):
  ```
  const hasHighQualityEvidence = feature.evidence.some(
    path => analyses[path]?.confidence === "high"
  );
  confidence: hasHighQualityEvidence && (files.length >= 2 || relatedEntries.length > 0)
    ? "high"
    : feature.confidence
  ```
- Reuse `calculateFeatureConfidence()` yang sudah ada di featureDetector jika memungkinkan

---

### 5. `featureDetector.ts` — Signal fixes

**Overlapping signal: `posthog`**
- Hapus `"posthog"`, `"@posthog"` dari `Logging & Monitoring` (L129)
- Tetap di `Analytics` — PostHog nature-nya analytics + session replay, bukan monitoring

**`matchesSignal` — ganti hardcode string ke flag**
- Sekarang: `if (featureName === "AI Integration")` — hardcode string
- Fix: tambah optional field `importOnly?: true` ke `FEATURE_SIGNALS` type
- `matchesSignal` check `signal.importOnly` bukan nama
- Extensible: kalau nanti ada signal lain yang import-only, tinggal set flag

---

### 6. `domainInference.ts` — Include medium confidence features

**`buildDomainInferenceInput` (L312)**
- Sekarang: `.filter((f) => f.confidence === "high")`
- Fix: `.filter((f) => f.confidence === "high" || f.confidence === "medium")`
- Rationale: capability features (dari capabilityDetector) bisa medium confidence
  tapi tetap representatif untuk domain inference input

---

### 7. `featureDetector.ts` — Regex pre-compile (Low)

**`matchesPathTerm` (L831)**
- Sekarang: `new RegExp(...)` dibuat fresh setiap pemanggilan
- Fix: pre-compile patterns untuk static terms ke `Map<string, RegExp>` di module scope
- Hanya compile untuk terms yang panjangnya ≤7 (yang pakai regex, bukan substring)
- Impact kecil kecuali project besar, tapi clean fix

---

### 8. Unit Test Baru

File: `packages/cli/test/feature-similarity-merge.test.ts`

**Pastikan sebelum nulis test:**
- `MAX_SEARCH_TERMS = 8` sudah settled → test #13 assert cap di 8, bukan 12
- Entity files sudah dipopulate → test file overlap bisa proper

18 skenario:

| # | Skenario | Expected |
|---|---|---|
| 1 | `computeSimilarity("Plan Management", "Customizable Plans")` | >= 0.35 |
| 2 | `computeSimilarity("Authentication", "Search")` | < 0.35 |
| 3 | `computeSimilarity("Search", "Search Functionality")` | >= 0.35 |
| 4 | File overlap dominan | match |
| 5 | Critical files beda, searchTerms tipis | no match |
| 6 | Tanpa searchTerms, files beda | no match |
| 7 | Identical features | 1.0 |
| 8 | Empty vs data | partial |
| 9 | `findSimilarFeature` list kosong | null |
| 10 | `mergeIntoFeatureList` existing enriched, name preserved | canonical wins |
| 11 | Same name | merge, not duplicate |
| 12 | `mergeFeatureData` union + dedup | |
| 13 | searchTerms capped at **8** (`MAX_SEARCH_TERMS`) | |
| 14 | `mergeDomainFeatures` batch no duplicate | |
| 15 | `jaccardSimilarity` both empty / one empty | 1.0 / 0.0 |
| 16 | `trigramSimilarity` "Authentication" vs "Authentication System" | ~0.82 |
| 17 | `buildFeatureFingerprint` same content | same fingerprint |
| 18 | `fingerprintSimilarity` consistent with `computeSimilarity` | |

**Tambahan (dari analisis):**
| 19 | Entity feature dengan `files: []` vs domain feature dengan files | merge works via terms/entities |
| 20 | `mergeFeatureData` useless businessFlow replaced by addition | |
| 21 | `mergeFeatureData` generic purpose replaced by specific addition purpose | |
| 22 | `attachFeatureEntryPoints` — 2 low-quality files tidak boost ke high | |

---

### 9. Regresi + Type Check

```bash
pnpm typecheck
pnpm test
```

Regresi manual: jalankan `devmap analyze` di project dailyfit dan ChatMe.
Check: tidak ada duplicate features, confidence masuk akal, domain inference dapat input yang representatif.

---

## Semua Selesai ✅

Semua 9 steps telah selesai dalam 2 sesi.

### Ringkasan Session 2 (ini)

| Step | Status |
|------|--------|
| 4. `projectMap.ts` — Confidence boost fix | ✅ `attachFeatureEntryPoints` now accepts `analyses` param; confidence boost requires at least 1 evidence file with `analysisConfidence: "high"` |
| 5. `featureDetector.ts` — Signal fixes | ✅ Removed `"posthog"`, `"@posthog"` from Logging & Monitoring; replaced hardcoded `featureName === "AI Integration"` with `importOnly?: true` flag on signal type |
| 6. `domainInference.ts` — Medium confidence | ✅ `buildDomainInferenceInput` now includes both `"high"` and `"medium"` confidence features |
| 7. `featureDetector.ts` — Regex pre-compile | ✅ Added `regexCache` Map to cache compiled RegExp patterns per term |
| 8. Unit test baru (22 skenario) | ✅ All 22 tests pass |
| 9. Regresi + type check | ✅ Typecheck passes; 22 new tests + 120 existing tests pass (17 pre-existing failures unchanged) |

### Catatan Pre-existing Failures

17 test failures are pre-existing (agent navigation ordering, context builder eval, init DEVMAP.md content, framework detection in CI) — tidak terkait hardening ini.

### Verification Commands

```bash
pnpm test:types        # typecheck
pnpm test:unit         # unit tests (termasuk 22 baru)
```

---

## File yang Berubah

| File | Severity | Alasan |
|------|----------|--------|
| `featureSimilarity.ts` | Medium | Config extraction, explainability, MAX_SEARCH_TERMS |
| `featureDetector.ts` | High | Entity files, posthog, importOnly flag, regex pre-compile |
| `featureMerge.ts` | High | extractRelatedEntities, mergeFeatureData safety |
| `projectMap.ts` | Critical | Confidence boost quality gate |
| `domainInference.ts` | Medium | Include medium confidence |
| `test/feature-similarity-merge.test.ts` | — | Baru |

Total: 5 file source + 1 file test. Tidak ada breaking changes pada public API.
