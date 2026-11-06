const collator = new Intl.Collator("en");

/**
 * Text order that does not depend on the machine. `String#localeCompare` follows
 * LC_ALL/LANG, so `schema.prisma` and `seed.ts` swap places under cs_CZ ("ch" is
 * a letter there) and a snapshot of the same project differs per developer.
 */
export function compareText(left: string, right: string): number {
  return collator.compare(left, right);
}
