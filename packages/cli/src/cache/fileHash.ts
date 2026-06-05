import { createHash } from "node:crypto";

export function hashContent(content: string): string {
  return createHash("md5").update(content).digest("hex");
}
