import type { ScannedFile } from "../fileScanner.js";
import type { RouteInfo } from "../routeDetector.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type EntityInfo = {
  name: string;
  fields: FieldInfo[];
  relations: RelationInfo[];
  source: "prisma" | "route-hint";
};

export type FieldInfo = {
  name: string;
  type: string;
  isRelation: boolean;
  isList: boolean;
  isOptional: boolean;
};

export type RelationInfo = {
  from: string;
  to: string;
  kind: "one-to-one" | "one-to-many" | "many-to-many";
};

export type EntityGraph = {
  entities: EntityInfo[];
  relations: RelationInfo[];
  /** Flat list of entity names — shortcut buat featureDetector & capabilityDetector */
  entityNames: string[];
  /** Where entities came from — consumers dapat tau seberapa reliable data ini */
  source: "prisma" | "route-hint" | "empty";
};

// ---------------------------------------------------------------------------
// Extractor interface
// ---------------------------------------------------------------------------

/**
 * IEntityExtractor — contract yang harus diimplementasi semua extractor.
 *
 * Setiap extractor bertanggung jawab atas satu source (Prisma, Drizzle, dll).
 * Orchestrator di index.ts iterate extractor list dan stop di hasil pertama
 * yang non-empty — ini yang bikin fallback chain bisa kerja tanpa if-else panjang.
 */
export interface IEntityExtractor {
  /**
   * Nama extractor ini — untuk logging / debug.
   * Contoh: "prisma", "drizzle", "typeorm"
   */
  readonly name: string;

  /**
   * canHandle — quick check apakah extractor ini relevan untuk file-file ini.
   * Dipanggil sebelum extract() untuk short-circuit extractor yang tidak applicable.
   *
   * Contoh:
   *   Prisma extractor → return files.some(f => f.path.endsWith(".prisma"))
   *   Drizzle extractor → return files.some(f => isDrizzleSchemaFile(f))
   */
  canHandle(files: ScannedFile[]): boolean;

  /**
   * extract — parse files dan return list EntityInfo.
   * Hanya dipanggil kalau canHandle() return true.
   *
   * Return [] kalau parse gagal / tidak ada entity ditemukan —
   * orchestrator akan lanjut ke extractor berikutnya.
   */
  extract(files: ScannedFile[]): EntityInfo[];
}

/**
 * IRouteFallbackExtractor — contract khusus route-hint extractor.
 *
 * Dipisah dari IEntityExtractor karena input-nya berbeda (RouteInfo[] bukan ScannedFile[]).
 * Orchestrator panggil ini hanya kalau semua IEntityExtractor return kosong.
 */
export interface IRouteFallbackExtractor {
  readonly name: string;
  extract(routes: RouteInfo[]): EntityInfo[];
}
