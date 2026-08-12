# 02 — Vue & Nuxt: Full Support

**Status:** Scope besar — framework identity 0% (belum ada nilai `"vue"`/`"nuxt"` di
`Framework` type sama sekali), meskipun infrastruktur parsing-nya (`.vue` sudah discan,
`VuePreprocessor` sudah ekstrak `<script>`) sudah jalan.

**Prasyarat:** File `00-architecture-multi-framework-detection.md` (butuh
`FrontendFramework` type & array-based `detectRoutes`).

**Target file:**
- `packages/cli/src/analyzers/detectors/frameworkDetector.ts`
- `packages/cli/src/analyzers/detectors/routeDetector.ts`
- `packages/cli/src/analyzers/detectors/frontendFeatureDetector.ts`

---

## 1. Framework identity detection

Di `frameworkDetector.ts`, mirror pola exclusion yang sudah ada untuk React/Next.js:

```ts
// nuxt.config.* sudah cukup spesifik untuk berdiri sendiri tanpa gate,
// sama seperti next.config.* hari ini
if (files.some((file) => /(^|\/)nuxt\.config\.[cm]?[jt]s$/.test(file.path))) {
  detected.add("nuxt");
}
if ("nuxt" in dependencies) detected.add("nuxt");

// vue murni — HARUS exclude ketika nuxt terdeteksi, sama seperti react vs next.js.
// Runtime gate mencegah Vue UI library (vue cuma di peerDependencies) ke-misdetect
// sebagai app: perlu @vitejs/plugin-vue ATAU vue-cli-service sebagai bukti "ini app
// yang di-build", bukan sekadar dependency vue yang nempel.
const hasVueRuntime = "@vitejs/plugin-vue" in dependencies
  || "@vitejs/plugin-vue2" in dependencies
  || "vue-cli-service" in dependencies;
if (!("nuxt" in dependencies) && "vue" in dependencies && hasVueRuntime) {
  detected.add("vue");
}
```

File heuristic fallback (dipakai kalau manifest gak reliable, mirror pola Express):
`src/App.vue` atau `App.vue` di root — nama file yang cukup spesifik ke Vue untuk aman
dipakai tanpa gate tambahan.

Update `FRONTEND_ORDER` (dari file 00) supaya `nuxt` dicek sebelum `vue` — konsisten
dengan `nextjs` sebelum `react`.

## 2. Routing — dua jalur terpisah

### 2a. Nuxt file-based routing (`pages/**`)

Beda dari Next.js/Astro: Nuxt pakai `pages/` di ROOT project (bukan `src/pages/`),
kecuali `srcDir` di-custom di `nuxt.config.ts` — untuk v1, cukup cover default
(`(?:^|\/)pages\/`), catat custom `srcDir` sebagai limitation, jangan coba resolve
config file untuk itu (scope creep).

Konvensi sama seperti Next.js/Astro (bracket syntax untuk dynamic segment,
`[...slug]` untuk catch-all, strip `index`) — regex pattern:
```ts
/(?:^|\/)pages\/(.+)\.vue$/
```
`kind: "page"` untuk semua match ini.

**Opsional/stretch (tidak wajib untuk deliverable inti file ini):** Nuxt 3 juga punya
server routing sendiri lewat Nitro — file `server/api/**/*.ts` yang export
`defineEventHandler(...)`. Ini API layer bawaan Nuxt (banyak Nuxt app pakai ini
alih-alih Express terpisah). Kalau mau dicover:
```ts
/(?:^|\/)server\/api\/(.+)\.[cm]?[jt]s$/
```
`kind: "api"`, method biasanya dari nama file (`users.get.ts` → GET, `users.post.ts`
→ POST — Nitro pakai suffix nama file untuk method, BUKAN export function seperti
Next.js/Astro) atau default ke semua method kalau tidak ada suffix. Pisahkan jadi
task tersendiri kalau mau digarap — beda konvensi total dari page routing di atas.

### 2b. Vue Router (SPA, non-Nuxt) — extend `CLIENT_ROUTE_PATTERNS`

Di `frontendFeatureDetector.ts`, `CLIENT_ROUTE_PATTERNS` saat ini cuma cover React
Router (butuh `element:`/`Component:` — Vue Router pakai `component:` huruf kecil,
tidak akan pernah match pattern yang ada). Perlu DUA pattern baru, bukan satu, karena
Vue Router punya dua bentuk component reference yang berbeda:

**Bentuk 1 — identifier langsung** (component sudah di-import di atas):
```ts
/\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*(\w+)\s*[,}]/g
```
Ini bisa langsung masuk ke mekanisme resolusi yang SUDAH ADA
(`resolveRouteComponentFile` — cari identifier itu di `fileGraph[definedIn]`),
sama seperti pattern React yang lain.

**Bentuk 2 — lazy import inline** (JAUH lebih umum di real-world Vue Router karena
ini pattern yang direkomendasikan resmi di dokumentasi Vue Router untuk
code-splitting):
```ts
component: () => import('./views/About.vue')
```
Ini regex-nya beda dan **hasil capture-nya bukan identifier, tapi string path**:
```ts
/\{\s*path:\s*["'`]([^"'`]+)["'`][^}]*?component:\s*\(\)\s*=>\s*import\(\s*["'`]([^"'`]+)["'`]\s*\)/g
```
⚠️ **Titik kritis:** `resolveRouteComponentFile` yang ada SEKARANG cuma tahu cara
resolve identifier by name-matching ke `fileGraph` — dia tidak akan bisa resolve
hasil capture bentuk 2 ini (bukan identifier, tapi relative path string). Bentuk 2
butuh fungsi resolusi TERPISAH: resolve relative path string itu terhadap folder
`definedIn` (path join + normalize, ingat Vue import biasanya sudah include
extension `.vue` eksplisit, beda dari import JS/TS yang sering omit extension),
lalu cocokkan ke daftar file yang ke-scan. Kalau bentuk 2 ini di-skip/lupa
diimplementasi, Vue Router detection akan KELIHATAN jalan (regex match path-nya)
tapi diam-diam gagal resolve file untuk hampir semua route real-world — trap yang
gampang kelewat kalau cuma test dengan fixture yang pakai bentuk 1.

Kedua bentuk perlu konvergen ke `ClientRoute` type yang sama sebelum masuk ke
`collectOwnedFiles`/feature-building yang sudah ada — jangan duplikasi logic
feature-building, cukup tambah jalur resolusi file di awal.

## 3. Opsional: Pinia/Vuex store extraction

Roadmap (`docs/roadmap.md` Phase 3) sudah rencanakan ini sejak awal ("Store extraction
(Zustand, Redux Toolkit, Pinia, Vuex legacy)"). Untuk Vue: deteksi `defineStore(` call
site (Pinia) atau `Vuex.Store(`/`createStore(` (Vuex legacy) — paling natural masuk
sebagai signal tambahan di `FEATURE_SIGNALS` (`featureDetector.ts`), pola yang sama
kemungkinan besar sudah dipakai untuk deteksi library lain (Stripe, Redis, dst) — cek
struktur `FEATURE_SIGNALS` yang ada sebelum implementasi supaya konsisten, jangan bikin
mekanisme paralel baru. Prioritas lebih rendah dari §1–2, boleh dikerjakan terpisah.

## 4. Catatan kecil, opsional, TIDAK spesifik ke Vue

`fileRole.ts` belum ada kategori khusus untuk folder `composables/` (Vue 3) — tapi ini
gap yang SAMA juga berlaku untuk `hooks/` di React (keduanya jatuh ke
`application-source` fallback hari ini). Kalau mau dibenerin, benerin konsisten untuk
dua-duanya sekaligus, jangan cuma untuk Vue. Sama halnya, folder `stores/` (Pinia) bisa
ditambahkan ke pattern `isServicePath` bareng `store/` generic (Redux/Zustand) — lagi,
lakukan sekaligus untuk semua ekosistem kalau dikerjakan, bukan cuma Vue.

## 5. Test plan

Fixture baru: `test/fixtures/vue-project/` (Vite+Vue Router SPA, pakai lazy-import
form supaya menguji bentuk 2 di §2b) dan `test/fixtures/nuxt-project/` (file-based
routing, `nuxt.config.ts`).

Assertion inti:
- `detectFramework` → `"vue"` untuk project SPA, `"nuxt"` untuk project Nuxt (dan
  BUKAN keduanya sekaligus untuk project Nuxt — exclusion harus jalan)
- Nuxt: route `/blog/[slug]` terdeteksi dari `pages/blog/[slug].vue`
- Vue Router SPA: route dari BENTUK 1 (identifier) DAN BENTUK 2 (lazy import)
  sama-sama resolve ke file yang benar — dua test case terpisah, jangan cuma test
  salah satu
- End-to-end lewat `createProjectMap()`: feature muncul di `snapshot.features` untuk
  kedua jenis project

## 6. Acceptance checklist

- [ ] `vue` dan `nuxt` masuk `FrontendFramework`, saling exclude dengan benar
- [ ] Nuxt `pages/**` file-based routing terdeteksi (dynamic + catch-all + index-strip)
- [ ] Vue Router bentuk identifier DAN bentuk lazy-import dua-duanya resolve ke file
      yang benar (bukan cuma salah satu)
- [ ] Fixture + test untuk kedua jenis project (SPA & Nuxt) ditambahkan dan hijau
- [ ] (Opsional, catat terpisah kalau tidak dikerjakan sekarang) Nitro server routes,
      Pinia store extraction, `composables`/`stores` fileRole
