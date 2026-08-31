// Minimal read-only .xlsx reader. An xlsx is a ZIP of XML; node:zlib inflates the entries and a
// small regex pass pulls the cells out. Enough to validate configuration against the source workbook,
// and no third-party dependency (NFR-01).
// ponytail: local-header walk, no central directory, no zip64 — fine for the tracker workbooks we read.
import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";

function unzip(buf) {
  const files = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue; }
    const method = buf.readUInt16LE(i + 8);
    const flags = buf.readUInt16LE(i + 6);
    let compressed = buf.readUInt32LE(i + 18);
    let uncompressed = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString("utf8", i + 30, i + 30 + nameLen);
    const dataStart = i + 30 + nameLen + extraLen;
    if (flags & 0x08 && !compressed) {          // sizes live in a trailing data descriptor
      let end = dataStart;
      while (end < buf.length - 4 && buf.readUInt32LE(end) !== 0x08074b50) end++;
      compressed = end - dataStart;
      uncompressed = buf.readUInt32LE(end + 8);
    }
    const data = buf.subarray(dataStart, dataStart + compressed);
    if (!name.endsWith("/")) {
      try { files[name] = method === 0 ? data : inflateRawSync(data); } catch { /* skip unreadable entry */ }
    }
    i = dataStart + compressed;
  }
  return files;
}

const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
const stripTags = s => s.replace(/<[^>]+>/g, "");
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Read an .xlsx into { sheetName: [[cell,…],…] } with 1-based rows compacted to arrays. */
export function readWorkbook(path) {
  const files = unzip(readFileSync(path));
  const shared = [...(files["xl/sharedStrings.xml"]?.toString("utf8") || "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => unesc(stripTags(m[1])));

  const wb = files["xl/workbook.xml"]?.toString("utf8") || "";
  const rels = files["xl/_rels/workbook.xml.rels"]?.toString("utf8") || "";
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map(m => [attr(m[0], "Id"), attr(m[0], "Target")]));

  const out = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(attr(m[0], "name") || "");
    const rid = attr(m[0], "r:id");
    let target = relMap[rid] || "";
    target = target.replace(/^\/?xl\//, "").replace(/^\//, "");
    const xml = files["xl/" + target]?.toString("utf8");
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*)\/?>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
        const meta = c[1] ?? c[3] ?? "";
        const inner = c[2] ?? "";
        const ref = attr(meta, "r") || "";
        const col = ref.replace(/\d+/g, "");
        const idx = col.split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
        const t = attr(meta, "t");
        let v = null;
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        const im = inner.match(/<is>([\s\S]*?)<\/is>/);
        if (t === "s" && vm) v = shared[Number(vm[1])] ?? null;
        else if (t === "inlineStr" && im) v = unesc(stripTags(im[1]));
        else if (vm) v = unesc(stripTags(vm[1]));
        if (idx >= 0) cells[idx] = v;
      }
      rows.push(cells);
    }
    out[name] = rows;
  }
  return out;
}
