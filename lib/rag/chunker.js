/**
 * chunker.js — Split a long document into overlapping chunks suitable for
 * embedding + retrieval.
 *
 * The reference implementation slices by raw character count, which cuts words
 * and sentences in half. This version is paragraph/sentence-aware: it packs
 * whole paragraphs (then whole sentences) up to a target size, and carries a
 * character overlap tail between consecutive chunks so context isn't lost at
 * the boundaries.
 */

function normalizeWhitespace(text = "") {
  let s = String(text);
  if (typeof s.toWellFormed === "function") s = s.toWellFormed();
  return s
    .replace(/\u0000/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split an over-long paragraph into sentence-ish pieces. */
function splitSentences(paragraph) {
  // Split after . ! ? … (and Vietnamese spacing) while keeping it simple.
  const parts = paragraph
    .split(/(?<=[.!?…])\s+(?=[A-ZÀ-Ỹ0-9"'(])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [paragraph];
}

/**
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.chunkChars=1200]  Target max characters per chunk.
 * @param {number} [opts.overlap=200]      Characters of overlap between chunks.
 * @param {number} [opts.minChars=60]      Drop trailing chunks shorter than this.
 * @returns {string[]}
 */
export function chunkText(text, opts = {}) {
  const chunkChars = opts.chunkChars ?? 1200;
  const overlap = opts.overlap ?? 200;
  const minChars = opts.minChars ?? 60;

  const clean = normalizeWhitespace(text);
  if (!clean) return [];
  if (clean.length <= chunkChars) return [clean];

  // Build a list of "units" (paragraphs, further split if huge).
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const units = [];
  for (const p of paragraphs) {
    if (p.length <= chunkChars) {
      units.push(p);
    } else {
      // Paragraph too big: break into sentences, regroup to <= chunkChars.
      let buf = "";
      for (const s of splitSentences(p)) {
        if (buf && (buf.length + 1 + s.length) > chunkChars) {
          units.push(buf);
          buf = s;
        } else {
          buf = buf ? `${buf} ${s}` : s;
        }
      }
      if (buf) units.push(buf);
    }
  }

  // Greedily pack units into chunks, then add overlap tails.
  const rawChunks = [];
  let cur = "";
  for (const u of units) {
    if (cur && (cur.length + 2 + u.length) > chunkChars) {
      rawChunks.push(cur);
      cur = u;
    } else {
      cur = cur ? `${cur}\n\n${u}` : u;
    }
  }
  if (cur) rawChunks.push(cur);

  if (overlap <= 0 || rawChunks.length <= 1) {
    return rawChunks.filter((c) => c.length >= minChars || rawChunks.length === 1);
  }

  // Prepend an overlap tail (last `overlap` chars of previous chunk) to each
  // subsequent chunk, snapped to a word boundary for readability.
  const withOverlap = [];
  for (let i = 0; i < rawChunks.length; i++) {
    if (i === 0) {
      withOverlap.push(rawChunks[i]);
      continue;
    }
    const prev = rawChunks[i - 1];
    let tail = prev.slice(Math.max(0, prev.length - overlap));
    const sp = tail.indexOf(" ");
    if (sp > 0) tail = tail.slice(sp + 1);
    withOverlap.push(`${tail}\n\n${rawChunks[i]}`.trim());
  }

  return withOverlap.filter((c, i) => c.length >= minChars || i === 0);
}

export default { chunkText };
