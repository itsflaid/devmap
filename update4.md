# 04 — Backend: Fastify Support

**Status:** Effort menengah, prioritas tinggi — Fastify makin populer sebagai
alternatif Express, dan sintaksnya cukup dekat sehingga banyak yang bisa direuse dari
pendekatan Express.

**Prasyarat:** File `00-architecture-multi-framework-detection.md` — termasuk fix
Express router-mount-prefix di sana, KARENA file ini reuse pendekatan cross-file
resolution yang sama untuk kasus Fastify (§3).

**Target file:**
- `packages/cli/src/analyzers/detectors/frameworkDetector.ts`
- `packages/cli/src/analyzers/detectors/routeDetector.ts`

---

## 1. Framework identity detection

```ts
if ("fastify" in dependencies) detected.add("fastify");
```
Tidak perlu runtime gate tambahan seperti Vue/React (dependency `fastify` di project
sendiri sudah cukup spesifik — beda dari `react`/`vue` yang bisa nempel sebagai
peerDependency di library UI yang tidak terkait).

**Tidak perlu logic exclusion terpisah untuk "kecuali NestJS pakai Fastify adapter"**
— ini beda dari kasus Vue/Nuxt atau Svelte/SvelteKit yang butuh exclusion eksplisit di
level masing-masing detector. Untuk backend, priority order di `BACKEND_ORDER`
(`["nestjs", "fastify", "express", "koa"]`, dari file 00) sudah otomatis menang-kan
`nestjs` kalau dua-duanya kedeteksi (project NestJS yang pakai
`@nestjs/platform-fastify` biasanya juga install `fastify` langsung). Tidak perlu
kerjaan tambahan di sini — cukup pastikan urutan `BACKEND_ORDER` benar.

## 2. Route detection — method-chaining

Sintaks Fastify dekat dengan Express tapi nama instance lebih variatif
(`fastify`, `app`, `server` — Express hampir selalu konsisten `app`/`router`):

```ts
const fastifyRoutePattern =
  /\b(?:fastify|app|server)\.(get|post|put|patch|delete|options|head)\(\s*["'`]([^"'`]+)["'`]/gi;
```

Sengaja TIDAK include `use` di sini (beda dari Express) — Fastify tidak punya
konvensi `app.use(prefix, subInstance)` untuk composition path, mekanismenya beda
(lihat §3).

## 3. Route detection — object style `.route({...})`

```js
fastify.route({ method: 'GET', url: '/users', handler: ... })
```

```ts
/\.route\(\s*\{[^}]*?method:\s*["'`]?(\w+)["'`]?[^}]*?url:\s*["'`]([^"'`]+)["'`]/gs
```

Sama seperti catatan yang sudah ada di kode untuk pattern React Router object-style:
ini asumsikan `method` muncul sebelum `url` dalam urutan penulisan yang umum —
urutan terbalik adalah known v1 miss, bukan bug yang perlu dikejar sekarang.
`method` kadang berupa array (`method: ['GET', 'POST']`) — kalau mau dicover, perlu
pattern kedua atau post-processing capture group itu jadi array split-by-comma;
kalau tidak, minimal jangan crash di kasus ini (skip/treat as single unmatched).

## 4. Route detection — plugin/prefix composition (mirror Express fix)

Fastify punya padanan persis dari masalah router-mounting Express yang sudah
dibenerin di file 00 §5:
```js
// index.ts
fastify.register(usersRoutes, { prefix: '/api/users' });
// routes/users.ts
export default function usersRoutes(fastify) {
  fastify.get('/', handler); // relatif terhadap prefix '/api/users'
}
```
Regex untuk menangkap mount ini (perhatikan URUTAN capture group KEBALIK dari Express
— identifier duluan, baru prefix):
```ts
/\.register\(\s*(\w+)\s*,\s*\{[^}]*?prefix:\s*["'`]([^"'`]+)["'`]/g
```
Resolusi identifier → file: **reuse fungsi/pendekatan yang sama persis dari file 00
§5** (resolve lewat `graph[currentFile]`, fallback heuristic "satu file dengan route
match" kalau resolusi by-name terlalu rumit). Jangan tulis ulang mekanisme baru —
kalau file 00 sudah bikin helper yang reusable (misal `resolveMountedRoutes(prefix,
identifier, currentFile, graph, files)`), panggil helper yang sama di sini dengan
input dari regex `.register()` ini.

## 5. Yang TIDAK perlu diubah

- `fileRole.ts` — komentar di `isAPIHandlerPath` sudah eksplisit menyebut
  "Express/Fastify/Hono router files", dan pattern path-based-nya
  (`src/routes?/`, `src/routers?/`) sudah generic terhadap framework. File route
  Fastify otomatis ke-classify `api-handler` tanpa perubahan.
- `capabilityDetector.ts` — otomatis jalan begitu routes terisi.

## 6. Test plan

Fixture baru `test/fixtures/fastify-project/`, mirror struktur
`test/fixtures/express-project/` TAPI kali ini beri route method sungguhan di file
yang di-`register()` (supaya benar-benar menguji komposisi prefix, tidak seperti
fixture Express lama yang kosong):
```
package.json                  (dependency: fastify)
src/server.ts                 (fastify.register(usersRoutes, { prefix: '/api/users' }))
src/routes/users.ts           (export default fn, fastify.get('/', ...), fastify.get('/:id', ...))
```

Assertion inti:
- `detectFramework` → `"fastify"`
- Route `/api/users` (GET) dan `/api/users/:id` (GET) muncul dengan prefix ter-compose
  dengan benar — INI yang paling penting dibuktikan, bukan cuma deteksi identity-nya
- Test object-style `.route({...})` terpisah dari method-chaining

## 7. Acceptance checklist

- [ ] `fastify` masuk `BackendFramework`, urutan prioritas di bawah `nestjs`
- [ ] Method-chaining (`fastify.get`/`app.get`/`server.get`) terdeteksi
- [ ] Object-style `.route({...})` terdeteksi
- [ ] Plugin/prefix composition (`.register(x, {prefix})`) resolve cross-file dengan
      benar, reuse mekanisme dari file 00 §5
- [ ] Fixture + test baru yang benar-benar menguji komposisi prefix (bukan router
      kosong seperti fixture Express lama)
