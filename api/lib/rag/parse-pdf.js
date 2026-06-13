/**
 * parse-pdf.js — Extract plain text from a PDF using `pdf-parse` (pure Node,
 * works on Vercel serverless; no Python required).
 *
 * NOTE: we import the library entry at `pdf-parse/lib/pdf-parse.js` instead of
 * the package root. The package root (`index.js`) contains a debug branch that
 * tries to read a bundled test PDF when `module.parent` is falsy — which is
 * exactly what happens after esbuild bundling on Vercel, causing an ENOENT
 * crash. Importing the lib directly avoids that branch entirely.
 */
import fs from "fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/**
 * @param {Buffer|string} input  A Buffer of the PDF bytes, OR a filesystem path.
 * @returns {Promise<{ text: string, pages: number }>}
 */
export async function parsePdf(input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const data = await pdfParse(buffer);
  return {
    text: data.text || "",
    pages: data.numpages || 0,
  };
}

export default { parsePdf };
