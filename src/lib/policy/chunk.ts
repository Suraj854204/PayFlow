export interface Chunk {
  idx: number;
  page: number;
  content: string;
}

export const CHUNK_TARGET = 900;
export const CHUNK_OVERLAP = 150;
export const MAX_CHUNKS = 400;

/** Collapses runs of spaces but keeps paragraph breaks, which are where chunks prefer to split. */
function tidy(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits page texts into overlapping passages of roughly CHUNK_TARGET characters. Splits fall on
 * paragraph, then sentence, boundaries, and each chunk remembers its page so answers can cite it.
 */
export function chunkPages(pages: string[]): Chunk[] {
  const out: Chunk[] = [];
  pages.forEach((raw, i) => {
    const text = tidy(raw);
    if (!text) return;
    const paras = text.split(/\n\s*\n/).flatMap((p) => {
      if (p.length <= CHUNK_TARGET) return [p];
      return p.match(/[^.!?\n]+(?:[.!?]+|\n|$)\s*/g) ?? [p];
    });
    let cur = "";
    const flush = () => {
      const c = cur.trim();
      if (c.length >= 20) out.push({ idx: out.length, page: i + 1, content: c });
    };
    for (const part of paras) {
      const piece = part.trim();
      if (!piece) continue;
      if (cur && cur.length + piece.length + 1 > CHUNK_TARGET) {
        flush();
        // Carry the tail of the previous chunk so a rule split across a boundary is still found.
        const tail = cur.slice(-CHUNK_OVERLAP);
        const cut = tail.search(/\s/);
        cur = `${cut >= 0 ? tail.slice(cut + 1) : tail} `;
      }
      cur += `${piece}\n`;
      while (cur.length > CHUNK_TARGET * 2) {
        // A single enormous unbroken piece: hard split.
        out.push({ idx: out.length, page: i + 1, content: cur.slice(0, CHUNK_TARGET).trim() });
        cur = cur.slice(CHUNK_TARGET - CHUNK_OVERLAP);
      }
    }
    flush();
  });
  return out.slice(0, MAX_CHUNKS).map((c, idx) => ({ ...c, idx }));
}
