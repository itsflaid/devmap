# 05 — Backend: NestJS Support

**Status:** Effort PALING TINGGI dari semua update ini — bukan karena kompleks secara
konsep, tapi karena paradigmanya (decorator + class) tidak cocok dengan pendekatan
regex flat yang dipakai semua detector lain di codebase ini. Worth dikerjakan
terpisah, jangan digabung buru-buru dengan file 04.

**Prasyarat:** File `00-architecture-multi-framework-detection.md` — khususnya urutan
`BACKEND_ORDER = ["nestjs", "fastify", "express", "koa"]`. NestJS HARUS dicek dan
menang duluan sebelum express/fastify diputuskan, karena Nest secara default berjalan
di atas Express (`@nestjs/platform-express`) atau opsional Fastify
(`@nestjs/platform-fastify`) — kalau urutannya salah, project Nest bisa ke-label
salah sebagai Express/Fastify polos.

**Target file:**
- `packages/cli/src/analyzers/detectors/frameworkDetector.ts`
- File BARU: `packages/cli/src/analyzers/detectors/nestRouteDetector.ts` (disarankan
  terpisah dari `routeDetector.ts` karena pendekatannya beda total — AST, bukan regex)

---

## 1. Framework identity detection

```ts
if ("@nestjs/core" in dependencies || "@nestjs/common" in dependencies) {
  detected.add("nestjs");
}
```
File heuristic fallback: `nest-cli.json` — nama file yang sangat spesifik ke Nest,
aman dipakai tanpa gate tambahan (mirror `next.config.*`).

## 2. Kenapa regex tidak cocok di sini

Semua route detector lain di codebase ini (Express, dan yang diusulkan untuk Fastify)
bekerja dengan regex flat per-baris karena pemanggilan method (`app.get(path, ...)`)
selalu satu ekspresi yang berdiri sendiri. NestJS beda:

```ts
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string) { /* ... */ }

  @Post()
  create(@Body() dto: CreateUserDto) { /* ... */ }
}
```

Untuk resolve path yang benar (`GET /users/:id`, `POST /users`), butuh:
1. Tahu `@Controller('users')` itu decorator di LEVEL CLASS, prefix-nya `'users'`
   (argumen opsional — `@Controller()` tanpa argumen = prefix kosong)
2. Tahu method `findOne`/`create` itu ada DI DALAM class itu (scope-nya jelas)
3. Tahu decorator `@Get(':id')`/`@Post()` nempel di method itu, argumennya juga
   opsional (kosong = cuma pakai prefix controller)
4. Compose prefix + method path

Regex tidak punya konsep "baris ini ada di dalam class X" — kalaupun dipaksa dengan
line-range heuristic, hasilnya rapuh (gampang salah waktu ada nested class, komentar
berisi contoh decorator, dst). **Pakai `ts-morph` untuk ini** — sudah jadi dependency
project (`"ts-morph": "^28.0.0"` di `package.json`), dan API-nya pas untuk kasus ini:
`SourceFile.getClasses()` → tiap `ClassDeclaration` punya `.getDecorators()` dan
`.getMethods()`, tiap method juga punya `.getDecorators()` sendiri dengan scope yang
benar secara otomatis.

## 3. Sketsa implementasi

```ts
import { Project, SyntaxKind } from "ts-morph";

const ROUTE_DECORATORS = new Set(
  ["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"]
);

function detectNestRoutes(files: ScannedFile[]): RouteInfo[] {
  // Pre-filter murah SEBELUM parse ts-morph — jangan parse ulang seluruh project
  // dengan Project baru kalau filenya jelas bukan kandidat controller. Project
  // sudah punya ts-morph Project instance di analysis/tsMorphAnalyzer.ts untuk
  // FileAnalysis lain — CEK DULU apakah FileAnalysis yang sudah ada (imports,
  // topFunctions, symbols) sudah cukup buat derive ini tanpa parse ulang. Kalau
  // tidak cukup, baru bikin Project ts-morph terpisah, tapi tetap gated:
  const candidates = files.filter((f) =>
    /\.[cm]?[jt]s$/.test(f.path) && f.content.includes("@Controller")
  );
  if (candidates.length === 0) return [];

  const project = new Project({ useInMemoryFileSystem: true });
  const routes: RouteInfo[] = [];

  for (const file of candidates) {
    const sourceFile = project.createSourceFile(file.path, file.content);

    for (const cls of sourceFile.getClasses()) {
      const controllerDecorator = cls.getDecorator("Controller");
      if (!controllerDecorator) continue;

      const prefixArg = controllerDecorator.getArguments()[0];
      const prefix = prefixArg?.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ?? "";
      // Catatan: @Controller({ path: '...' }) — bentuk object untuk versioning API —
      // TIDAK tercover oleh line di atas (cuma handle string literal arg). Skip
      // dulu untuk v1, prefixArg akan undefined dan prefix jadi "" — tidak crash,
      // tapi route-nya bakal kurang prefix. Catat sebagai known limitation.

      for (const method of cls.getMethods()) {
        const routeDecorator = method.getDecorators()
          .find((d) => ROUTE_DECORATORS.has(d.getName()));
        if (!routeDecorator) continue;

        const pathArg = routeDecorator.getArguments()[0];
        const subPath = pathArg?.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ?? "";
        const httpMethod = routeDecorator.getName().toUpperCase();

        routes.push({
          path: `/${[prefix, subPath].filter(Boolean).join("/")}`.replace(/\/+/g, "/"),
          file: file.path,
          kind: "api",
          methods: [httpMethod === "ALL" ? "GET" : httpMethod] // ALL butuh keputusan
                                                                  // sendiri — expand ke
                                                                  // semua method, atau
                                                                  // biarkan satu nilai
                                                                  // khusus? putuskan
                                                                  // waktu implementasi
        });
      }
    }
  }

  return sortRoutes(routes);
}
```

Ini sketsa untuk mengarahkan pendekatan, BUKAN kode final siap tempel — review error
handling (file yang gagal di-parse ts-morph jangan sampai crash seluruh analisis,
bungkus per-file try/catch), dan putuskan penanganan `@All()` serta bentuk object
`@Controller({...})` sebelum implementasi final.

**Opsional/stretch:** `app.setGlobalPrefix('api')` di file bootstrap (`main.ts`) akan
menambah prefix ke SEMUA route Nest sekaligus. Ini cross-file (satu file bootstrap
mempengaruhi semua controller) — kalau straightforward untuk ditambahkan sebagai
langkah terpisah setelah routes per-controller selesai dikumpulkan, worth ditambah;
kalau tidak, catat sebagai known gap, jangan blocking untuk sisa deliverable ini.

## 4. Yang TIDAK perlu diubah

Ini bagian yang justru meringankan scope: `fileRole.ts` **sudah** mengklasifikasi
konvensi penamaan Nest dengan benar TANPA perubahan apapun, karena kebetulan
vocabulary-nya sama:
- `*.controller.ts` → `isAPIHandlerPath` (sudah match `\.(controller)\.[cm]?[jt]sx?$`)
- `*.service.ts` → `isServicePath` (sudah match `\.(service)\.[cm]?[jt]sx?$`)
- `*.guard.ts`/`*.interceptor.ts` → `isMiddlewarePath` (sudah match)
- `*.repository.ts` → `isRepositoryPath` (sudah match)

Tidak perlu sentuh `fileRole.ts` untuk NestJS sama sekali. `capabilityDetector.ts`
juga otomatis jalan begitu `routes` terisi dari `detectNestRoutes`.

## 5. Test plan

Fixture baru `test/fixtures/nestjs-project/`:
```
package.json                       (dependency: @nestjs/core, @nestjs/common,
                                     @nestjs/platform-express)
nest-cli.json
src/users/users.controller.ts      (@Controller('users'), @Get(':id'), @Post())
src/users/users.service.ts         (harus ke-classify "service" tanpa perubahan
                                     fileRole.ts — test ini SEKALIGUS meregresi
                                     klaim di §4)
```

Assertion inti:
- `detectFramework` → `"nestjs"`, BUKAN `"express"` (meskipun
  `@nestjs/platform-express` ada) — buktikan priority order jalan
- `GET /users/:id` dan `POST /users` terdeteksi dengan prefix yang benar dari
  `@Controller('users')`
- `src/users/users.service.ts` punya `fileRole` = `"service"` (buktikan klaim §4,
  jangan cuma diasumsikan)
- Test `@Controller()` tanpa argumen (prefix kosong) tidak crash, hasil path masuk
  akal

## 6. Acceptance checklist

- [ ] `nestjs` masuk `BackendFramework`, prioritas PALING TINGGI di `BACKEND_ORDER`
- [ ] Project Nest dengan `@nestjs/platform-express` TETAP ke-label `"nestjs"`, bukan
      `"express"` — ada test yang membuktikan ini eksplisit
- [ ] Route extraction pakai ts-morph (bukan regex), scope class benar
- [ ] Pre-filter murah (`content.includes("@Controller")`) sebelum parse ts-morph,
      supaya tidak parse ulang seluruh project tanpa perlu
- [ ] Error per-file di-handle (satu controller gagal parse tidak menjatuhkan seluruh
      analisis)
- [ ] Fixture + test ditambahkan, termasuk test yang membuktikan fileRole.ts sudah
      benar tanpa perubahan
