/** Translates a navigation label if the catalogue has it, otherwise shows it as written. */
export function navLabel(t: { has: (k: string) => boolean; (k: string): string }, label: string) {
  return t.has(label) ? t(label) : label;
}
