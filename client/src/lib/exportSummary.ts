// Client-side export of a meeting summary to DOCX, ODT, PDF, CSV and TXT.
// No extra dependencies: DOCX/ODT use a tiny store-only ZIP writer, PDF is hand-built.

export type ExportData = {
  title: string;
  language?: string | null;
  summary: string;
  decisions: string[];
  actionItems: { task: string; owner: string; due: string }[];
  transcript: string;
  /** "chat" exports only the transcript field as one "Conversation" section (used by Copilot). */
  kind?: "meeting" | "chat";
};

export type ExportFormat = "docx" | "odt" | "pdf" | "csv" | "txt";

const enc = new TextEncoder();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Remove control chars that are illegal in XML.
const xmlSafe = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function sections(d: ExportData): { heading: string; lines: string[] }[] {
  if (d.kind === "chat") return [{ heading: "Conversation", lines: d.transcript.trim() ? d.transcript.trim().split(/\r?\n/) : ["No messages yet."] }];
  const out: { heading: string; lines: string[] }[] = [];
  out.push({ heading: "Summary", lines: d.summary.trim() ? d.summary.trim().split(/\r?\n/) : ["No summary generated yet."] });
  out.push({ heading: "Key decisions", lines: d.decisions.length ? d.decisions.map(x => `• ${x}`) : ["No decisions generated yet."] });
  out.push({
    heading: "Action items",
    lines: d.actionItems.length ? d.actionItems.map(a => `• ${a.task} (Owner: ${a.owner}; Due: ${a.due})`) : ["No action items generated yet."],
  });
  if (d.transcript.trim()) out.push({ heading: "Transcript", lines: d.transcript.trim().split(/\r?\n/) });
  return out;
}

// ---------- ZIP (store only) ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.data);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true); // store
    lh.setUint16(10, 0, true);
    lh.setUint16(12, 0x21, true); // date 1980-01-01
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------- DOCX ----------
function buildDocx(d: ExportData): Uint8Array {
  const p = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${esc(xmlSafe(text))}</w:t></w:r></w:p>`;
  let body = p(d.title || "Meeting summary", "Title");
  body += p(`Language: ${d.language || "n/a"} · Generated ${new Date().toLocaleString()} by IntellMeet`);
  for (const s of sections(d)) {
    body += p(s.heading, "Heading1");
    for (const l of s.lines) body += p(l);
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", data: doc },
    { name: "word/styles.xml", data: styles },
  ]);
}

// ---------- ODT ----------
function buildOdt(d: ExportData): Uint8Array {
  const p = (text: string, style = "Standard") => `<text:p text:style-name="${style}">${esc(xmlSafe(text))}</text:p>`;
  let body = p(d.title || "Meeting summary", "T");
  body += p(`Language: ${d.language || "n/a"} · Generated ${new Date().toLocaleString()} by IntellMeet`);
  for (const s of sections(d)) {
    body += p(s.heading, "H");
    for (const l of s.lines) body += p(l);
  }
  const ns = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"`;
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ns} office:version="1.2"><office:automatic-styles/><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ns} office:version="1.2"><office:styles><style:style style:name="Standard" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.2cm"/></style:style><style:style style:name="T" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.4cm"/><style:text-properties fo:font-size="20pt" fo:font-weight="bold" fo:color="#1d4ed8"/></style:style><style:style style:name="H" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.5cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="14pt" fo:font-weight="bold" fo:color="#1d4ed8"/></style:style></office:styles></office:document-styles>`;
  return zip([
    { name: "mimetype", data: "application/vnd.oasis.opendocument.text" },
    { name: "META-INF/manifest.xml", data: `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>` },
    { name: "content.xml", data: content },
    { name: "styles.xml", data: styles },
  ]);
}

// ---------- CSV / TXT ----------
function buildCsv(d: ExportData): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows: string[][] = [["Type", "Content", "Owner", "Due"]];
  if (d.kind === "chat") {
    d.transcript.split(/\r?\n/).filter(Boolean).forEach(l => rows.push([l.startsWith("You:") ? "You" : "Copilot", l.replace(/^(You|Copilot):\s*/, ""), "", ""]));
    return "\uFEFF" + rows.map(r => r.map(q).join(",")).join("\r\n");
  }
  rows.push(["Meeting", d.title, "", ""]);
  if (d.summary.trim()) rows.push(["Summary", d.summary.trim(), "", ""]);
  d.decisions.forEach(x => rows.push(["Decision", x, "", ""]));
  d.actionItems.forEach(a => rows.push(["Action item", a.task, a.owner, a.due]));
  if (d.transcript.trim()) rows.push(["Transcript", d.transcript.trim(), "", ""]);
  return "﻿" + rows.map(r => r.map(q).join(",")).join("\r\n");
}
function buildTxt(d: ExportData): string {
  const out = [d.title || "Meeting summary", `Language: ${d.language || "n/a"}`, ""];
  for (const s of sections(d)) out.push(s.heading.toUpperCase(), ...s.lines, "");
  return out.join("\r\n");
}

// ---------- PDF (Helvetica, Latin text) ----------
function buildPdf(d: ExportData): Uint8Array {
  const map: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "·": "-" };
  const clean = (s: string) =>
    s.replace(/[‘’“”–—…•·]/g, c => map[c]).replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const W = 595, H = 842, M = 54, bottom = 60;
  type Line = { t: string; size: number; bold: boolean; gap: number };
  const lines: Line[] = [];
  const wrap = (text: string, size: number, bold: boolean, gap: number) => {
    const max = Math.floor((W - 2 * M) / (size * (bold ? 0.6 : 0.55)));
    const words = clean(text).split(/\s+/).filter(Boolean);
    if (!words.length) return void lines.push({ t: "", size, bold, gap });
    let cur = "";
    for (const w of words) {
      let word = w;
      while (word.length > max) {
        if (cur) { lines.push({ t: cur, size, bold, gap }); cur = ""; }
        lines.push({ t: word.slice(0, max), size, bold, gap });
        word = word.slice(max);
      }
      if ((cur + " " + word).trim().length > max) { lines.push({ t: cur, size, bold, gap }); cur = word; }
      else cur = (cur + " " + word).trim();
    }
    if (cur) lines.push({ t: cur, size, bold, gap });
  };
  wrap(d.title || "Meeting summary", 20, true, 6);
  wrap(`Language: ${d.language || "n/a"} - Generated by IntellMeet`, 9, false, 10);
  for (const s of sections(d)) {
    lines.push({ t: "", size: 6, bold: false, gap: 0 });
    wrap(s.heading, 14, true, 4);
    for (const l of s.lines) wrap(l, 11, false, 3);
  }
  const pages: string[] = [];
  let y = H - M, content = "";
  const flush = () => { pages.push(content); content = ""; y = H - M; };
  for (const l of lines) {
    const step = l.size * 1.35 + l.gap;
    if (y - step < bottom) flush();
    y -= step;
    if (l.t) {
      const blue = l.bold && l.size >= 14;
      content += `BT /${l.bold ? "F2" : "F1"} ${l.size} Tf ${blue ? "0.11 0.31 0.85" : "0 0 0"} rg ${M} ${y.toFixed(1)} Td (${l.t.replace(/[\\()]/g, m => "\\" + m)}) Tj ET\n`;
    }
  }
  flush();
  const objs: string[] = [];
  const n = pages.length;
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  pages.forEach((c, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}endstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const out = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) out[i] = pdf.charCodeAt(i) & 0xff;
  return out;
}

const MIME: Record<ExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  pdf: "application/pdf",
  csv: "text/csv;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};

export function exportSummary(format: ExportFormat, d: ExportData) {
  let data: BlobPart;
  if (format === "docx") data = buildDocx(d) as unknown as BlobPart;
  else if (format === "odt") data = buildOdt(d) as unknown as BlobPart;
  else if (format === "pdf") data = buildPdf(d) as unknown as BlobPart;
  else if (format === "csv") data = buildCsv(d);
  else data = buildTxt(d);
  const base = (d.title || "meeting-summary").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "meeting-summary";
  const url = URL.createObjectURL(new Blob([data], { type: MIME[format] }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}-summary.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
