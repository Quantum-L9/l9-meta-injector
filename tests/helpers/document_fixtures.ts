// document_fixtures.ts — genuine files in each format the decoders claim.
//
// These are built rather than committed, and built from the format's own bytes
// rather than from a library, for the same reason the decoders avoid a library:
// a fixture produced by the same code that reads it proves nothing. An OOXML
// fixture here is a real ZIP of real parts; the PDF is a real PDF with a real
// FlateDecode content stream and a real xref. Word, PowerPoint, Excel and any
// PDF reader open them.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { writeRawZip } from "./zip_fixtures";

function xmlHeader(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

/** The two parts every OOXML container needs before it is one. */
function ooxmlSkeleton(contentTypes: string, relationships: string): { name: string; content: string }[] {
  return [
    { name: "[Content_Types].xml", content: `${xmlHeader()}${contentTypes}` },
    { name: "_rels/.rels", content: `${xmlHeader()}${relationships}` },
  ];
}

export interface DocxSpec {
  title: string;
  headings: string[];
  paragraphs: string[];
  listItems?: string[];
  table?: string[][];
  /** An external relationship, recorded by the decoder and never fetched. */
  externalLink?: string;
}

/** A real .docx: styles carry the heading levels, as Word writes them. */
export function writeDocx(target: string, spec: DocxSpec): string {
  const paragraph = (text: string, style?: string): string =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}`
    + `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

  const listItem = (text: string): string =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>`
    + `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

  const tableXml = spec.table === undefined
    ? ""
    : `<w:tbl>${spec.table
      .map((row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`)
      .join("")}</w:tbl>`;

  const body = [
    paragraph(spec.title, "Title"),
    ...spec.headings.map((heading) => paragraph(heading, "Heading1")),
    ...spec.paragraphs.map((text) => paragraph(text)),
    ...(spec.listItems ?? []).map(listItem),
    tableXml,
  ].join("");

  const parts = [
    ...ooxmlSkeleton(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + "</Types>",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + "</Relationships>",
    ),
    {
      name: "docProps/core.xml",
      content: `${xmlHeader()}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" `
        + 'xmlns:dc="http://purl.org/dc/elements/1.1/">'
        + `<dc:title>${escapeXml(spec.title)}</dc:title></cp:coreProperties>`,
    },
    {
      name: "word/document.xml",
      content: `${xmlHeader()}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
        + `<w:body>${body}</w:body></w:document>`,
    },
  ];

  if (spec.externalLink !== undefined) {
    parts.push({
      name: "word/_rels/document.xml.rels",
      content: `${xmlHeader()}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" `
        + `Target="${escapeXml(spec.externalLink)}" TargetMode="External"/></Relationships>`,
    });
  }

  writeRawZip(target, parts.map((part) => ({ name: part.name, content: part.content })));
  return target;
}

export interface PptxSlide {
  title: string;
  bullets: string[];
  notes?: string;
}

/** A real .pptx, with title placeholders and speaker notes. */
export function writePptx(target: string, slides: PptxSlide[]): string {
  const shape = (text: string, isTitle: boolean): string =>
    "<p:sp><p:nvSpPr><p:nvPr>"
    + (isTitle ? '<p:ph type="title"/>' : "")
    + "</p:nvPr></p:nvSpPr><p:txBody>"
    + `<a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p>`
    + "</p:txBody></p:sp>";

  const slidePart = (slide: PptxSlide): string =>
    `${xmlHeader()}<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" `
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>'
    + shape(slide.title, true)
    + slide.bullets.map((bullet) => shape(bullet, false)).join("")
    + "</p:spTree></p:cSld></p:sld>";

  const notesPart = (notes: string): string =>
    `${xmlHeader()}<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" `
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>'
    + shape(notes, false)
    + "</p:spTree></p:cSld></p:notes>";

  const parts = [
    ...ooxmlSkeleton(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/></Types>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>'
      + "</Relationships>",
    ),
    {
      name: "ppt/presentation.xml",
      content: `${xmlHeader()}<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
    },
  ];
  slides.forEach((slide, index) => {
    parts.push({ name: `ppt/slides/slide${index + 1}.xml`, content: slidePart(slide) });
    if (slide.notes !== undefined) {
      parts.push({ name: `ppt/notesSlides/notesSlide${index + 1}.xml`, content: notesPart(slide.notes) });
    }
  });
  writeRawZip(target, parts.map((part) => ({ name: part.name, content: part.content })));
  return target;
}

export interface XlsxSheet {
  name: string;
  /** Rows of cell text. A value starting `=` is written as a formula. */
  rows: string[][];
}

/** A real .xlsx with a shared-string table, as Excel writes one. */
export function writeXlsx(target: string, sheets: XlsxSheet[]): string {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const intern = (value: string): number => {
    const existing = sharedIndex.get(value);
    if (existing !== undefined) return existing;
    const index = shared.length;
    shared.push(value);
    sharedIndex.set(value, index);
    return index;
  };

  const columnName = (index: number): string => {
    let name = "";
    let remaining = index;
    do {
      name = String.fromCharCode(65 + (remaining % 26)) + name;
      remaining = Math.floor(remaining / 26) - 1;
    } while (remaining >= 0);
    return name;
  };

  const sheetParts = sheets.map((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
        if (value.startsWith("=")) {
          return `<c r="${reference}"><f>${escapeXml(value.slice(1))}</f><v>0</v></c>`;
        }
        return `<c r="${reference}" t="s"><v>${intern(value)}</v></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    return {
      name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      content: `${xmlHeader()}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
        + `<sheetData>${rows}</sheetData></worksheet>`,
    };
  });

  const parts = [
    ...ooxmlSkeleton(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/></Types>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + "</Relationships>",
    ),
    {
      name: "xl/workbook.xml",
      content: `${xmlHeader()}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>`
        + sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")
        + "</sheets></workbook>",
    },
    ...sheetParts,
    {
      name: "xl/sharedStrings.xml",
      content: `${xmlHeader()}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">`
        + shared.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join("")
        + "</sst>",
    },
  ];
  writeRawZip(target, parts.map((part) => ({ name: part.name, content: part.content })));
  return target;
}

/** A real .ipynb, with markdown and code cells and an output that must not be read. */
export function writeNotebook(target: string, spec: {
  title: string;
  markdown: string[];
  code: string[];
  withOutputs?: boolean;
}): string {
  const cells: unknown[] = [
    { cell_type: "markdown", metadata: {}, source: [`# ${spec.title}\n`] },
    ...spec.markdown.map((text) => ({ cell_type: "markdown", metadata: {}, source: [`${text}\n`] })),
    ...spec.code.map((source) => ({
      cell_type: "code",
      execution_count: 1,
      metadata: {},
      source: [`${source}\n`],
      outputs: spec.withOutputs === true
        ? [{ output_type: "display_data", data: { "text/html": ["<script>never()</script>"] }, metadata: {} }]
        : [],
    })),
  ];
  const notebook = {
    cells,
    metadata: { kernelspec: { display_name: "Python 3", name: "python3" }, language_info: { name: "python" } },
    nbformat: 4,
    nbformat_minor: 5,
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(notebook, null, 1)}\n`, "utf8");
  return target;
}

/** A saved page, with a script and a stylesheet the decoder must not read. */
export function writeHtml(target: string, spec: {
  title: string;
  headings: string[];
  paragraphs: string[];
  link?: { href: string; text: string };
  table?: string[][];
}): string {
  const table = spec.table === undefined
    ? ""
    : `<table>${spec.table.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>`;
  const html = [
    "<!doctype html><html><head>",
    `<title>${spec.title}</title>`,
    '<meta name="description" content="A saved page kept for the record.">',
    "<style>body { color: rebeccapurple; }</style>",
    "</head><body>",
    ...spec.headings.map((heading, index) => `<h${index === 0 ? 1 : 2}>${heading}</h${index === 0 ? 1 : 2}>`),
    ...spec.paragraphs.map((text) => `<p>${text}</p>`),
    spec.link === undefined ? "" : `<p><a href="${spec.link.href}">${spec.link.text}</a></p>`,
    table,
    "<script>document.title = 'this must never run';</script>",
    "</body></html>",
  ].join("\n");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, "utf8");
  return target;
}

/**
 * A real native-text PDF.
 *
 * Built byte by byte with a Flate-compressed content stream and a correct xref,
 * so what the decoder reads is a PDF and not a fixture shaped like one. Any PDF
 * reader opens the result.
 */
export function writePdf(target: string, lines: string[], options: { title?: string } = {}): string {
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    ...lines.flatMap((line) => [`(${line.replace(/([()\\])/g, "\\$1")}) Tj`, "0 -18 Td"]),
    "ET",
  ].join("\n");
  const compressed = zlib.deflateSync(Buffer.from(content, "latin1"));

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `__STREAM__`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (buffer: Buffer): void => {
    chunks.push(buffer);
    offset += buffer.length;
  };
  const header = Buffer.from(`%PDF-1.4\n%\xe2\xe3\xcf\xd3\n`, "latin1");
  push(header);

  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const number = index + 1;
    if (body === "__STREAM__") {
      push(Buffer.from(`${number} 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, "latin1"));
      push(compressed);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
      return;
    }
    push(Buffer.from(`${number} 0 obj\n${body}\nendobj\n`, "latin1"));
  });

  const xrefOffset = offset;
  const xrefLines = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (const entry of offsets) xrefLines.push(`${String(entry).padStart(10, "0")} 00000 n `);
  const info = options.title === undefined ? "" : ` /Title (${options.title.replace(/([()\\])/g, "\\$1")})`;
  push(Buffer.from(
    `${xrefLines.join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R${info} >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`,
    "latin1",
  ));

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.concat(chunks));
  return target;
}

/** A PDF whose pages carry an image and no text layer: a scan. */
export function writeScannedPdf(target: string): string {
  const image = Buffer.from("\xff\xd8\xff\xe0scanned-page-bytes\xff\xd9", "latin1");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
    "__IMAGE__",
    "__EMPTY__",
  ];
  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (buffer: Buffer): void => {
    chunks.push(buffer);
    offset += buffer.length;
  };
  push(Buffer.from("%PDF-1.4\n", "latin1"));
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const number = index + 1;
    if (body === "__IMAGE__") {
      push(Buffer.from(
        `${number} 0 obj\n<< /Type /XObject /Subtype /Image /Width 100 /Height 100 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
        "latin1",
      ));
      push(image);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
      return;
    }
    if (body === "__EMPTY__") {
      const empty = Buffer.from("q 612 0 0 792 0 0 cm /Im1 Do Q", "latin1");
      push(Buffer.from(`${number} 0 obj\n<< /Length ${empty.length} >>\nstream\n`, "latin1"));
      push(empty);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
      return;
    }
    push(Buffer.from(`${number} 0 obj\n${body}\nendobj\n`, "latin1"));
  });
  const xrefOffset = offset;
  const xrefLines = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (const entry of offsets) xrefLines.push(`${String(entry).padStart(10, "0")} 00000 n `);
  push(Buffer.from(
    `${xrefLines.join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    "latin1",
  ));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.concat(chunks));
  return target;
}

/** A PDF that declares encryption: readable as a file, unreadable as text. */
export function writeEncryptedPdf(target: string): string {
  const body = [
    "%PDF-1.4",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj",
    "3 0 obj\n<< /Filter /Standard /V 2 /R 3 /Length 128 >>\nendobj",
    "trailer\n<< /Size 4 /Root 1 0 R /Encrypt 3 0 R >>",
    "%%EOF",
  ].join("\n");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "latin1");
  return target;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
