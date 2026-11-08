import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_POLICY_BYTES = 5 * 1024 * 1024;
export const MAX_POLICY_PAGES = 120;

export class PolicyFileError extends Error {}

/** Page-by-page text of a PDF or a plain-text/markdown file. Scanned PDFs have no text and are refused. */
export async function extractPages(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<string[]> {
  if (bytes.byteLength === 0) throw new PolicyFileError("The file is empty.");
  if (bytes.byteLength > MAX_POLICY_BYTES)
    throw new PolicyFileError("The file is larger than 5 MB.");
  const isPdf =
    mime === "application/pdf" ||
    filename.toLowerCase().endsWith(".pdf") ||
    String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";
  if (isPdf) {
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF")
      throw new PolicyFileError("That does not look like a valid PDF.");
    let pages: string[];
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      if (pdf.numPages > MAX_POLICY_PAGES)
        throw new PolicyFileError(`Policies are limited to ${MAX_POLICY_PAGES} pages.`);
      const { text } = await extractText(pdf, { mergePages: false });
      pages = text as string[];
    } catch (e) {
      if (e instanceof PolicyFileError) throw e;
      throw new PolicyFileError("The PDF could not be read. Is it damaged or password-protected?");
    }
    if (pages.join("").trim().length < 40)
      throw new PolicyFileError(
        "No text found in this PDF. It may be a scan; upload a text-based PDF instead.",
      );
    return pages;
  }
  if (!/\.(txt|md)$/i.test(filename) && !mime.startsWith("text/"))
    throw new PolicyFileError("Upload a PDF, .txt or .md file.");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.trim().length < 40) throw new PolicyFileError("The file has almost no text.");
  // Plain text has no pages: treat every ~3000 characters as one so citations still locate it.
  const pages: string[] = [];
  for (let i = 0; i < text.length; i += 3000) pages.push(text.slice(i, i + 3000));
  return pages;
}
