// document_markup_fidelity.test.ts — decoded text equals document text.
//
// The decoders in src/documents read markup (OOXML parts, HTML pages), delimited
// text and notebooks. Each case here pins one way the decoded text used to drift
// from what the document says: fused words, harvested markup, a tag that ended
// inside an attribute value. Test names carry the regression id they discharge.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_DECODER_BUDGET,
  DecodeInput,
  XmlEvent,
  defaultDecoderRegistry,
  openOoxml,
  parseXml,
  tokenizeHtml,
} from "../src/documents";
import { writeRawZip } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-markup-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const registry = defaultDecoderRegistry();

function decode(absolutePath: string, budget = DEFAULT_DECODER_BUDGET) {
  const decoder = registry.forPath(absolutePath);
  expect(decoder, `no decoder claims ${absolutePath}`).toBeDefined();
  const input: DecodeInput = {
    artifactId: "vsrc:test",
    contentHash: `sha256:${"b".repeat(64)}`,
    sourcePath: path.basename(absolutePath),
    absolutePath,
    sizeBytes: fs.statSync(absolutePath).size,
    budget,
  };
  return (decoder as NonNullable<typeof decoder>).decode(input);
}

type Outcome = ReturnType<typeof decode>;

function decoded(outcome: Outcome) {
  expect(outcome.decoded, outcome.decoded ? "" : `${outcome.reason}: ${outcome.message}`).toBe(true);
  if (!outcome.decoded) throw new Error("not decoded");
  return outcome.document;
}

function texts(outcome: Outcome): string[] {
  return decoded(outcome).blocks.map((block) => block.text);
}

function events(source: string): XmlEvent[] {
  const out: XmlEvent[] = [];
  parseXml(source, 64, (event) => {
    out.push(event);
  });
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

/** A docx whose document.xml body is exactly what the test wrote. */
function docx(body: string, prolog = '<?xml version="1.0" encoding="UTF-8"?>'): string {
  const file = path.join(tmp(), "doc.docx");
  writeRawZip(file, [
    { name: "[Content_Types].xml", content: "<Types/>" },
    {
      name: "word/document.xml",
      content: `${prolog}<w:document ${W} ${MC}><w:body>${body}</w:body></w:document>`,
    },
  ]);
  return file;
}

function pptx(spTree: string): string {
  const file = path.join(tmp(), "deck.pptx");
  writeRawZip(file, [
    { name: "[Content_Types].xml", content: "<Types/>" },
    {
      name: "ppt/slides/slide1.xml",
      content: '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
        + `${spTree}</p:spTree></p:cSld></p:sld>`,
    },
  ]);
  return file;
}

function xlsx(spec: { workbook: string; sheets: string[]; shared?: string; extra?: { name: string; content: string }[] }): string {
  const file = path.join(tmp(), "book.xlsx");
  writeRawZip(file, [
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "xl/workbook.xml", content: spec.workbook },
    ...spec.sheets.map((content, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content })),
    ...(spec.shared === undefined ? [] : [{ name: "xl/sharedStrings.xml", content: spec.shared }]),
    ...(spec.extra ?? []),
  ]);
  return file;
}

function html(source: string): string {
  const file = path.join(tmp(), "page.html");
  fs.writeFileSync(file, source, "utf8");
  return file;
}

// ───────────────────────────── WU-060 ─────────────────────────────

describe("WU-060 XML text-node fidelity", () => {
  it("REG-WU-060-RC-116-a: a space-only docx run separates the words around it", () => {
    const file = docx(
      '<w:p><w:r><w:t>Owner</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>'
      + "<w:r><w:t>Mel</w:t></w:r></w:p>",
    );
    expect(texts(decode(file))).toEqual(["Owner Mel"]);
  });

  it("REG-WU-060-RC-116-b: a space-only pptx run separates the words around it", () => {
    const file = pptx(
      "<p:sp><p:txBody><a:p><a:r><a:t>Owner</a:t></a:r><a:r><a:t> </a:t></a:r>"
      + "<a:r><a:t>Mel</a:t></a:r></a:p></p:txBody></p:sp>",
    );
    expect(texts(decode(file))).toEqual(["Owner Mel"]);
  });

  it("REG-WU-060-RC-116-c: a space-only rich shared-string run separates the words around it", () => {
    const file = xlsx({
      workbook: '<workbook><sheets><sheet name="People" sheetId="1"/></sheets></workbook>',
      sheets: ['<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'],
      shared: '<sst><si><r><t>Owner</t></r><r><t xml:space="preserve"> </t></r><r><t>Mel</t></r></si></sst>',
    });
    const document = decoded(decode(file));
    const cell = document.blocks.find((block) => block.kind === "cell");
    expect(cell?.text).toBe("Owner Mel");
    expect(cell?.locator).toEqual({ kind: "spreadsheet_cell", sheet: "People", cell_or_range: "A1" });
  });

  it("REG-WU-060-RC-116-d: indentation between pretty-printed elements never enters block text", () => {
    const docxFile = docx("<w:p>\n  <w:r>\n    <w:t>A</w:t>\n  </w:r>\n</w:p>");
    expect(texts(decode(docxFile))).toEqual(["A"]);

    const pptxFile = pptx("<p:sp>\n  <p:txBody>\n    <a:p>\n      <a:r>\n        <a:t>A</a:t>\n      </a:r>\n    </a:p>\n  </p:txBody>\n</p:sp>");
    expect(texts(decode(pptxFile))).toEqual(["A"]);

    const xlsxFile = xlsx({
      workbook: '<workbook>\n  <sheets>\n    <sheet name="S" sheetId="1"/>\n  </sheets>\n</workbook>',
      sheets: ['<worksheet>\n <sheetData>\n  <row r="1">\n   <c r="A1" t="inlineStr">\n    <is>\n     <t>A</t>\n    </is>\n   </c>\n'
        + '   <c r="B1">\n    <v>7</v>\n   </c>\n  </row>\n </sheetData>\n</worksheet>'],
      shared: "<sst>\n  <si>\n    <t>unused</t>\n  </si>\n</sst>",
    });
    const cells = decoded(decode(xlsxFile)).blocks.filter((block) => block.kind === "cell");
    expect(cells.map((block) => block.text)).toEqual(["A", "7"]);
  });

  it("REG-WU-060-RC-116-e: parseXml delivers a whitespace-only text node", () => {
    const delivered = events("<t> </t>").filter((event) => event.type === "text");
    expect(delivered).toEqual([{ type: "text", text: " ", depth: 1 }]);
    const cdata = events("<t><![CDATA[ ]]></t>").filter((event) => event.type === "text");
    expect(cdata.map((event) => event.type === "text" && event.text)).toEqual([" "]);
  });

  it("REG-WU-060-RC-116-f: single-run documents decode as they did", () => {
    const file = docx('<w:p><w:r><w:t xml:space="preserve">Status: WIP</w:t></w:r></w:p>');
    expect(texts(decode(file))).toEqual(["Status: WIP"]);
  });

  it("REG-WU-060-RC-117-a: a HYPERLINK field contributes its result, not its instruction", () => {
    const file = docx(
      '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>'
      + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
      + '<w:r><w:instrText xml:space="preserve"> HYPERLINK "https://intranet/plan" </w:instrText></w:r>'
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      + "<w:r><w:t>the plan</w:t></w:r>"
      + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );
    expect(texts(decode(file))).toEqual(["See the plan"]);
  });

  it("REG-WU-060-RC-117-b: a TOC field paragraph reads as its result", () => {
    const file = docx(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
      + '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      + "<w:r><w:t>Introduction</w:t></w:r>"
      + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );
    const all = texts(decode(file));
    expect(all).toEqual(["Introduction"]);
    expect(JSON.stringify(all)).not.toContain("TOC");
    expect(JSON.stringify(all)).not.toContain("\\\\o");
  });

  it("REG-WU-060-RC-117-c: a text box in both AlternateContent branches is read once", () => {
    const box = "<w:txbxContent><w:p><w:r><w:t>Callout: blocked</w:t></w:r></w:p></w:txbxContent>";
    const file = docx(
      "<w:p><w:r><mc:AlternateContent>"
      + `<mc:Choice Requires="wps"><w:drawing><wps:txbx>${box}</wps:txbx></w:drawing></mc:Choice>`
      + `<mc:Fallback><w:pict><v:textbox>${box}</v:textbox></w:pict></mc:Fallback>`
      + "</mc:AlternateContent></w:r></w:p>",
    );
    const all = texts(decode(file));
    expect(all.filter((text) => text === "Callout: blocked")).toHaveLength(1);
    expect(all).toEqual(["Callout: blocked"]);
  });

  it("REG-WU-060-RC-117-d: moved-from text is not read alongside its moved-to copy", () => {
    const file = docx(
      '<w:p><w:moveFrom w:id="1"><w:r><w:t>Old place</w:t></w:r></w:moveFrom></w:p>'
      + '<w:p><w:moveTo w:id="2"><w:r><w:t>Old place</w:t></w:r></w:moveTo></w:p>',
    );
    expect(texts(decode(file))).toEqual(["Old place"]);
  });

  it("REG-WU-060-RC-117-e: an AlternateContent with only a Fallback branch still yields its text once", () => {
    const file = docx(
      "<w:p><w:r><mc:AlternateContent><mc:Fallback><w:pict><v:textbox><w:txbxContent>"
      + "<w:p><w:r><w:t>Fallback only</w:t></w:r></w:p>"
      + "</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>",
    );
    expect(texts(decode(file))).toEqual(["Fallback only"]);
  });

  it("REG-WU-060-RC-117-f: deleted text stays suppressed and plain paragraphs are unchanged", () => {
    const file = docx(
      '<w:p><w:r><w:t xml:space="preserve">Keep </w:t></w:r>'
      + '<w:del w:id="1"><w:r><w:delText>removed</w:delText></w:r></w:del>'
      + "<w:r><w:t>this</w:t></w:r></w:p>",
    );
    expect(texts(decode(file))).toEqual(["Keep this"]);
  });

  it("REG-WU-060-RC-123-a: a '>' inside a quoted XML attribute does not end the tag", () => {
    expect(events('<sheet name="a>b" sheetId="1"/>')).toEqual([
      { type: "open", name: "sheet", attributes: { name: "a>b", sheetId: "1" }, selfClosing: true, depth: 0 },
      { type: "close", name: "sheet", depth: 0 },
    ]);
    expect(events("<sheet name='x>y'/>")[0]).toMatchObject({ attributes: { name: "x>y" } });
  });

  it("REG-WU-060-RC-123-b: a workbook sheet name containing '>' is cited as written", () => {
    const file = xlsx({
      workbook: '<workbook><sheets><sheet name="Q3 > Q2 deltas" sheetId="1"/></sheets></workbook>',
      sheets: ['<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c></row></sheetData></worksheet>'],
    });
    const document = decoded(decode(file));
    const cell = document.blocks.find((block) => block.text === "Revenue");
    expect(cell?.locator).toEqual({ kind: "spreadsheet_cell", sheet: "Q3 > Q2 deltas", cell_or_range: "A1" });
    expect(document.blocks.some((block) => block.kind === "heading" && block.text === "Q3 > Q2 deltas")).toBe(true);
  });

  it("REG-WU-060-RC-123-c: a DOCTYPE internal subset is skipped through its closing ']>'", () => {
    const file = docx(
      "<w:p><w:r><w:t>Status: blocked</w:t></w:r></w:p>",
      '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY e "x>y"> <!-- it\'s ] here --> <!ATTLIST a b CDATA "]>">]>',
    );
    const all = texts(decode(file));
    expect(all[0]).toBe("Status: blocked");
    expect(JSON.stringify(all)).not.toContain("]>");
  });

  it("REG-WU-060-RC-123-d: an entity-declaring part leaks neither the entity target nor ']>'", () => {
    const file = path.join(tmp(), "xxe.docx");
    writeRawZip(file, [
      { name: "[Content_Types].xml", content: "<Types/>" },
      {
        name: "word/document.xml",
        content:
          '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
          + '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const serialized = JSON.stringify(decoded(decode(file)));
    expect(serialized).not.toContain("root:");
    expect(serialized).not.toContain("/etc/passwd");
    expect(serialized).not.toContain("]>");
  });

  it("REG-WU-060-RC-123-e: a '>' inside a quoted HTML attribute does not end the tag", () => {
    const document = decoded(decode(html('<p><a href="x" title="a>b">link</a> after</p>')));
    expect(document.blocks.map((block) => block.text)).toEqual(["link after"]);
    expect(document.links.map((link) => link.href)).toEqual(["x"]);
    const tokens = tokenizeHtml('<a href="x" title="a>b">');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.attributes).toEqual({ href: "x", title: "a>b" });
  });

  it("REG-WU-060-RC-123-f: an apostrophe in an unquoted HTML value does not open a quote", () => {
    const tokens = tokenizeHtml("<a href=x title=it's>t</a>");
    expect(tokens.map((token) => token.kind)).toEqual(["open", "text", "close"]);
    expect(tokens[1]?.text).toBe("t");
    const document = decoded(decode(html("<p><a href=x title=it's>t</a></p>")));
    expect(document.blocks.map((block) => block.text)).toEqual(["t"]);
  });
});

// ───────────────────────────── WU-061 ─────────────────────────────

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const WORKSHEET_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const NOTES_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

function workbookXml(sheets: { name: string; rid?: string }[]): string {
  return '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((sheet, index) =>
      `<sheet name="${sheet.name}" sheetId="${index + 1}"${sheet.rid === undefined ? "" : ` r:id="${sheet.rid}"`}/>`).join("")
    + "</sheets></workbook>";
}

function workbookRels(targets: Record<string, string>): { name: string; content: string } {
  return {
    name: "xl/_rels/workbook.xml.rels",
    content: `<Relationships ${REL_NS}>`
      + Object.entries(targets).map(([id, target]) =>
        `<Relationship Id="${id}" Type="${WORKSHEET_REL}" Target="${target}"/>`).join("")
      + "</Relationships>",
  };
}

function inlineSheet(cells: Record<string, string>): string {
  return "<worksheet><sheetData>"
    + Object.entries(cells).map(([reference, text]) =>
      `<row r="${reference.replace(/^[A-Z]+/, "")}"><c r="${reference}" t="inlineStr"><is><t>${text}</t></is></c></row>`).join("")
    + "</sheetData></worksheet>";
}

function cellAt(outcome: Outcome, text: string) {
  return decoded(outcome).blocks.find((block) => block.text === text && block.kind === "cell")?.locator;
}

function inferred(outcome: Outcome): boolean {
  return decoded(outcome).diagnostics.some((diagnostic) => diagnostic.message.includes("inferred"));
}

/** A zip written member by member, for parts whose sizes the test controls. */
function rawXlsxOrDocx(name: string, members: Parameters<typeof writeRawZip>[1]): string {
  const file = path.join(tmp(), name);
  writeRawZip(file, members);
  return file;
}

describe("WU-061 OOXML relationships, bounded decompression, implied cell references", () => {
  it("REG-WU-061-RC-118-a: reordered tabs cite each cell under the sheet that holds it", () => {
    const file = xlsx({
      workbook: workbookXml([{ name: "Blocked", rid: "rId2" }, { name: "Roadmap", rid: "rId1" }]),
      sheets: [inlineSheet({ A1: "Ship v2 in Q3" }), inlineSheet({ A1: "Vendor contract unsigned" })],
      extra: [workbookRels({ rId1: "worksheets/sheet1.xml", rId2: "worksheets/sheet2.xml" })],
    });
    const outcome = decode(file);
    expect(cellAt(outcome, "Ship v2 in Q3")).toEqual({ kind: "spreadsheet_cell", sheet: "Roadmap", cell_or_range: "A1" });
    expect(cellAt(outcome, "Vendor contract unsigned"))
      .toEqual({ kind: "spreadsheet_cell", sheet: "Blocked", cell_or_range: "A1" });
    const headings = decoded(outcome).blocks.filter((block) => block.kind === "heading");
    // Sheets are emitted in workbook order, each with its own part.
    expect(headings.map((block) => block.text)).toEqual(["Blocked", "Roadmap"]);
    expect(inferred(outcome)).toBe(false);
  });

  it("REG-WU-061-RC-118-b: an unreferenced worksheet part is not given a declared sheet's name", () => {
    const file = xlsx({
      workbook: workbookXml([{ name: "Only", rid: "rId2" }]),
      sheets: [inlineSheet({ A1: "orphan part" }), inlineSheet({ A1: "real" })],
      extra: [workbookRels({ rId2: "worksheets/sheet2.xml" })],
    });
    const outcome = decode(file);
    expect(cellAt(outcome, "real")).toEqual({ kind: "spreadsheet_cell", sheet: "Only", cell_or_range: "A1" });
    const orphan = decoded(outcome).blocks.filter((block) => block.text === "orphan part");
    expect(orphan.every((block) => block.locator.kind === "spreadsheet_cell" && block.locator.sheet !== "Only")).toBe(true);
    expect(JSON.stringify(decoded(outcome).tables)).not.toContain("orphan part");
  });

  it("REG-WU-061-RC-118-c: a deleted middle sheet leaves the others correctly named", () => {
    const file = rawXlsxOrDocx("gap.xlsx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "xl/workbook.xml", content: workbookXml([{ name: "One", rid: "rId1" }, { name: "Three", rid: "rId3" }]) },
      workbookRels({ rId1: "worksheets/sheet1.xml", rId3: "worksheets/sheet3.xml" }),
      { name: "xl/worksheets/sheet1.xml", content: inlineSheet({ A1: "in one" }) },
      { name: "xl/worksheets/sheet3.xml", content: inlineSheet({ A1: "in three" }) },
    ]);
    const outcome = decode(file);
    expect(cellAt(outcome, "in one")).toMatchObject({ sheet: "One" });
    expect(cellAt(outcome, "in three")).toMatchObject({ sheet: "Three" });
  });

  it("REG-WU-061-RC-118-d: without workbook relationships the cells survive and the pairing is declared inferred", () => {
    const file = xlsx({
      workbook: workbookXml([{ name: "Roadmap", rid: "rId1" }, { name: "Blocked", rid: "rId2" }]),
      sheets: [inlineSheet({ A1: "first" }), inlineSheet({ A1: "second" })],
    });
    const outcome = decode(file);
    expect(cellAt(outcome, "first")).toMatchObject({ sheet: "Roadmap" });
    expect(cellAt(outcome, "second")).toMatchObject({ sheet: "Blocked" });
    const warning = decoded(outcome).diagnostics.find((diagnostic) => diagnostic.message.includes("inferred"));
    expect(warning).toMatchObject({ code: "decoder.malformed", severity: "warning" });
    expect(warning?.message).toContain("position");
  });

  it("REG-WU-061-RC-118-e: an escaping relationship target is refused and a package-absolute one resolves", () => {
    const file = xlsx({
      workbook: workbookXml([{ name: "Escape", rid: "rId1" }, { name: "Absolute", rid: "rId2" }]),
      sheets: [inlineSheet({ A1: "absolute target" })],
      extra: [
        workbookRels({ rId1: "../../etc/x.xml", rId2: "/xl/worksheets/sheet1.xml" }),
        { name: "etc/x.xml", content: inlineSheet({ A1: "escaped" }) },
      ],
    });
    const outcome = decode(file);
    expect(cellAt(outcome, "absolute target")).toMatchObject({ sheet: "Absolute" });
    expect(JSON.stringify(decoded(outcome).blocks)).not.toContain("escaped");
    expect(decoded(outcome).diagnostics.some((diagnostic) =>
      diagnostic.code === "decoder.malformed" && diagnostic.message.includes("../../etc/x.xml"))).toBe(true);
  });

  it("REG-WU-061-RC-118-f: speaker notes are attached through the slide's relationship, not the file number", () => {
    const slide = (text: string) => '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
      + `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const file = rawXlsxOrDocx("deck.pptx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "ppt/slides/slide1.xml", content: slide("First slide") },
      { name: "ppt/slides/slide2.xml", content: slide("Second slide") },
      { name: "ppt/slides/_rels/slide1.xml.rels", content: `<Relationships ${REL_NS}/>` },
      {
        name: "ppt/slides/_rels/slide2.xml.rels",
        content: `<Relationships ${REL_NS}><Relationship Id="rId9" Type="${NOTES_REL}" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
      },
      {
        name: "ppt/notesSlides/notesSlide1.xml",
        content: '<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>'
          + "<p:sp><p:txBody><a:p><a:r><a:t>Speaker note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>",
      },
    ]);
    const notes = decoded(decode(file)).blocks.filter((block) => block.text === "Speaker note");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.locator).toMatchObject({ kind: "pptx_shape", slide_number: 2, part: "ppt/notesSlides/notesSlide1.xml" });
  });

  it("REG-WU-061-RC-119-a: a part that lies about its size is refused like an honest bomb", () => {
    const bomb = `<w:document ${W}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p>${" ".repeat(31 * 1024 * 1024)}</w:body></w:document>`;
    const lying = rawXlsxOrDocx("lying.docx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      // Declares twice its compressed size; truly expands about 1000:1.
      { name: "word/document.xml", content: bomb, declaredUncompressedSize: 2 * zlib.deflateRawSync(Buffer.from(bomb)).length },
    ]);
    const honest = rawXlsxOrDocx("honest.docx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/document.xml", content: bomb },
    ]);
    const started = Date.now();
    const lyingOutcome = decode(lying);
    expect(Date.now() - started).toBeLessThan(5000);
    const honestOutcome = decode(honest);
    expect(lyingOutcome.decoded).toBe(false);
    expect(honestOutcome.decoded).toBe(false);
    if (lyingOutcome.decoded || honestOutcome.decoded) return;
    expect(lyingOutcome.reason).toBe(honestOutcome.reason);
    expect(lyingOutcome.diagnostics.some((diagnostic) =>
      diagnostic.code === "decoder.budget_exceeded" && diagnostic.part === "word/document.xml")).toBe(true);
  });

  it("REG-WU-061-RC-119-b: relationship parts stop inflating at the container allowance", () => {
    const filler = Buffer.from(" ".repeat(31 * 1024 * 1024));
    const members: Parameters<typeof writeRawZip>[1] = [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/document.xml", content: `<w:document ${W}><w:body><w:p><w:r><w:t>kept</w:t></w:r></w:p></w:body></w:document>` },
    ];
    const declared = 2 * zlib.deflateRawSync(filler).length;
    for (let index = 0; index < 20; index += 1) {
      members.push({ name: `word/_rels/part${index}.xml.rels`, content: filler, declaredUncompressedSize: declared });
    }
    const file = rawXlsxOrDocx("rels.docx", members);

    const started = Date.now();
    const outcome = decode(file, { ...DEFAULT_DECODER_BUDGET, maxContainerUncompressedBytes: 16 * 1024 * 1024 });
    expect(Date.now() - started).toBeLessThan(5000);
    const document = decoded(outcome);
    expect(document.blocks.map((block) => block.text)).toEqual(["kept"]);
    const skipped = document.diagnostics.filter((diagnostic) => diagnostic.message.includes("allowance"));
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.code).toBe("decoder.budget_exceeded");
    expect(skipped[0]?.message).toMatch(/\d+ part/);

    // Under the default allowance each lying part is still bounded by its ratio.
    const startedDefault = Date.now();
    expect(decoded(decode(file)).blocks.map((block) => block.text)).toEqual(["kept"]);
    expect(Date.now() - startedDefault).toBeLessThan(10000);
  });

  it("REG-WU-061-RC-119-c: an honestly declared 1025:1 part is refused before it is expanded", () => {
    const file = rawXlsxOrDocx("honest-ratio.docx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/document.xml", content: " ".repeat(4 * 1024 * 1024) },
    ]);
    const outcome = decode(file);
    expect(outcome.decoded).toBe(false);
    if (outcome.decoded) return;
    expect(outcome.diagnostics.some((diagnostic) => diagnostic.message.includes("declares a compression ratio"))).toBe(true);
  });

  it("REG-WU-061-RC-119-d: a stored empty part reads as empty", () => {
    const file = rawXlsxOrDocx("empty.docx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/empty.xml", content: "", stored: true },
    ]);
    const container = openOoxml(file, DEFAULT_DECODER_BUDGET);
    expect(container.readPart("word/empty.xml")).toBe("");
    expect(container.diagnostics).toEqual([]);
  });

  it("REG-WU-061-RC-119-e: a part producing exactly compressed x ratio bytes is read, one byte more is refused", () => {
    // Find a body whose deflated size divides its length, so the ratio limit is
    // an exact integer number of bytes.
    let body = "";
    let compressed = 0;
    for (let pad = 0; pad < 20_000; pad += 1) {
      const candidate = `<x>${"ab".repeat(400)}${"q".repeat(pad)}</x>`;
      const size = zlib.deflateRawSync(Buffer.from(candidate)).length;
      if (candidate.length % size === 0) {
        body = candidate;
        compressed = size;
        break;
      }
    }
    expect(compressed).toBeGreaterThan(0);
    const ratio = body.length / compressed;
    const budget = { ...DEFAULT_DECODER_BUDGET, maxCompressionRatio: ratio };

    const exact = rawXlsxOrDocx("exact.docx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/part.xml", content: body },
    ]);
    expect(openOoxml(exact, budget).readPart("word/part.xml")).toBe(body);

    // The same declared size over one more produced byte: only the runtime
    // ceiling can see the difference.
    const over = `${body} `;
    const overCompressed = zlib.deflateRawSync(Buffer.from(over)).length;
    const overBudget = { ...DEFAULT_DECODER_BUDGET, maxCompressionRatio: (over.length - 1) / overCompressed };
    const overFile = rawXlsxOrDocx("over.docx", [
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/part.xml", content: over, declaredUncompressedSize: over.length - 1 },
    ]);
    const container = openOoxml(overFile, overBudget);
    const limit = Math.floor(overCompressed * overBudget.maxCompressionRatio);
    expect(limit).toBeLessThan(over.length);
    expect(container.readPart("word/part.xml")).toBeNull();
    expect(container.diagnostics.some((diagnostic) => diagnostic.code === "decoder.budget_exceeded")).toBe(true);
  });

  it("REG-WU-061-RC-119-f: ordinary Office parts read unchanged under the new ceilings", () => {
    const file = docx("<w:p><w:r><w:t>Status: blocked</w:t></w:r></w:p>");
    expect(texts(decode(file))).toEqual(["Status: blocked"]);
    expect(decoded(decode(file)).diagnostics.filter((diagnostic) => diagnostic.code === "decoder.budget_exceeded")).toEqual([]);
  });

  it("REG-WU-061-RC-128-a: a cell without r is cited at the position it implies", () => {
    const file = xlsx({
      workbook: workbookXml([{ name: "S", rid: "rId1" }]),
      sheets: ['<worksheet><sheetData><row r="1"><c t="inlineStr"><is><t>Status: blocked</t></is></c></row></sheetData></worksheet>'],
      extra: [workbookRels({ rId1: "worksheets/sheet1.xml" })],
    });
    expect(cellAt(decode(file), "Status: blocked")).toEqual({ kind: "spreadsheet_cell", sheet: "S", cell_or_range: "A1" });
  });

  it("REG-WU-061-RC-128-b: implied references follow the previous cell and row", () => {
    const file = xlsx({
      workbook: workbookXml([{ name: "S", rid: "rId1" }]),
      sheets: ['<worksheet><sheetData>'
        + '<row r="3"><c r="B3" t="inlineStr"><is><t>bee</t></is></c><c t="inlineStr"><is><t>cee</t></is></c></row>'
        + '<row><c t="inlineStr"><is><t>next row</t></is></c></row>'
        + "</sheetData></worksheet>"],
      extra: [workbookRels({ rId1: "worksheets/sheet1.xml" })],
    });
    const outcome = decode(file);
    expect(cellAt(outcome, "bee")).toMatchObject({ cell_or_range: "B3" });
    expect(cellAt(outcome, "cee")).toMatchObject({ cell_or_range: "C3" });
    expect(cellAt(outcome, "next row")).toMatchObject({ cell_or_range: "A4" });
    // Placed in the sheet table too.
    expect(decoded(outcome).tables[0]?.rows).toEqual([["bee", "cee"], ["next row"]]);
  });

  it("REG-WU-061-RC-128-c: explicit references keep their locators", () => {
    const file = xlsx({
      workbook: workbookXml([{ name: "S", rid: "rId1" }]),
      sheets: [inlineSheet({ A1: "one", C7: "seven" })],
      extra: [workbookRels({ rId1: "worksheets/sheet1.xml" })],
    });
    const outcome = decode(file);
    expect(cellAt(outcome, "one")).toMatchObject({ cell_or_range: "A1" });
    expect(cellAt(outcome, "seven")).toMatchObject({ cell_or_range: "C7" });
  });
});

// ───────────────────────────── WU-062 ─────────────────────────────

function page(source: string) {
  return decoded(decode(html(source)));
}

function blockAt(document: ReturnType<typeof page>, text: string) {
  return document.blocks.find((block) => block.text === text);
}

describe("WU-062 HTML raw text, block model and named references", () => {
  it("REG-WU-062-RC-120-a: a '<' inside a script does not swallow the page after it", () => {
    const document = page(
      "<script>for (var i=0;i<n;i++){go(i);}</script><h1>Q3 Plan</h1><p>Status: blocked on legal</p>",
    );
    expect(blockAt(document, "Q3 Plan")?.kind).toBe("title");
    expect(blockAt(document, "Status: blocked on legal")?.kind).toBe("paragraph");
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("go(i)");
    expect(serialized).not.toContain("i++");
  });

  it("REG-WU-062-RC-120-b: a '<' inside a stylesheet does not swallow the page after it", () => {
    const document = page('<style>a[x="<"]{}</style><p>Kept</p>');
    expect(blockAt(document, "Kept")).toBeDefined();
    expect(JSON.stringify(document)).not.toContain("a[x");
  });

  it("REG-WU-062-RC-120-c: an end tag inside a script string does not corrupt node paths", () => {
    const document = page('<html><body><div><script>var s="</div>";</script><p>Kept</p></div></body></html>');
    expect(blockAt(document, "Kept")?.locator).toMatchObject({ kind: "html_node", node_path: "html/body/div/p" });
  });

  it("REG-WU-062-RC-120-d: the raw-text end tag is matched case-insensitively, with trailing space", () => {
    const document = page("<SCRIPT>if(a<b){}</SCRIPT ><p>Kept</p>");
    expect(blockAt(document, "Kept")).toBeDefined();
    expect(JSON.stringify(document)).not.toContain("if(a");
  });

  it("REG-WU-062-RC-120-e: a '<' inside the title is title text", () => {
    const document = page("<title>a < b</title><p>x</p>");
    expect(document.metadata.title).toBe("a < b");
    expect(blockAt(document, "x")?.locator).toMatchObject({ kind: "html_node", node_path: "p" });
  });

  it("REG-WU-062-RC-120-f: an unterminated script is diagnosed rather than silently emptying the page", () => {
    const outcome = decode(html("<script>var a=1;<p>never</p>"));
    const document = decoded(outcome);
    expect(blockAt(document, "never")).toBeUndefined();
    const warning = document.diagnostics.find((diagnostic) => diagnostic.severity === "warning");
    expect(warning?.message).toContain("script");
    expect(warning?.message).toContain("never closed");
  });

  it("REG-WU-062-RC-120-g: a page whose script and style hold no '<' decodes as it did", () => {
    const document = page(
      "<html><head><title>T</title><style>body { color: red; }</style></head>"
      + "<body><p>Prose</p><script>document.title = 'never run';</script></body></html>",
    );
    expect(document.blocks.map((block) => block.text)).toEqual(["T", "Prose"]);
    expect(JSON.stringify(document)).not.toContain("never run");
  });

  it("REG-WU-062-RC-120-h: raw-text scanning stays linear", () => {
    const started = Date.now();
    const long = tokenizeHtml(`<script>${"x".repeat(1_000_000)}`);
    expect(long.length).toBeLessThanOrEqual(2);
    const many = tokenizeHtml("<script>".repeat(100_000));
    expect(many.length).toBeLessThanOrEqual(2);
    const closed = tokenizeHtml("<script>a<b</script>".repeat(100_000));
    expect(closed.length).toBe(300_000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("REG-WU-062-RC-121-a: text directly inside a div is a paragraph", () => {
    const document = page("<body><div>Status: blocked on legal</div><div>Owner: Mel</div></body>");
    expect(blockAt(document, "Status: blocked on legal")).toMatchObject({
      kind: "paragraph",
      locator: { kind: "html_node", node_path: "body/div" },
    });
    expect(blockAt(document, "Owner: Mel")).toMatchObject({
      kind: "paragraph",
      locator: { kind: "html_node", node_path: "body/div" },
    });
  });

  it("REG-WU-062-RC-121-b: bare body text around a block is kept, in order", () => {
    const document = page("<body>Bare text<p>Para</p>Tail text</body>");
    expect(document.blocks.map((block) => block.text)).toEqual(["Bare text", "Para", "Tail text"]);
  });

  it("REG-WU-062-RC-121-c: a line break separates lines", () => {
    const document = page("<p>Owner: Mel<br>Status: blocked</p>");
    expect(document.blocks.map((block) => block.text)).toEqual(["Owner: Mel\nStatus: blocked"]);
    expect(tokenizeHtml("<td>a<br>b</td>").length).toBeGreaterThan(0);
    const cells = page("<table><tr><td>a<br>b</td></tr></table>");
    expect(cells.tables[0]?.rows).toEqual([["a\nb"]]);
  });

  it("REG-WU-062-RC-121-d: a cell whose text is inside nested blocks still fills the table", () => {
    const document = page(
      "<table><tr><th><p>Item</p></th><th><p>Status</p></th></tr>"
      + "<tr><td><p>Contract</p></td><td><p>Blocked</p></td></tr></table>",
    );
    expect(document.tables[0]?.rows).toEqual([["Item", "Status"], ["Contract", "Blocked"]]);
  });

  it("REG-WU-062-RC-121-e: whitespace-only body text yields nothing", () => {
    const document = page("<body>   \n  </body>");
    expect(document.blocks).toEqual([]);
    expect(document.diagnostics).toEqual([]);
  });

  it("REG-WU-062-RC-121-f: tables of plain cells and the page title decode as they did", () => {
    const document = page(
      "<html><head><title>Ingest Specification</title></head><body>"
      + "<table><tr><td>field</td><td>type</td></tr><tr><td>root_id</td><td>string</td></tr></table></body></html>",
    );
    expect(document.tables[0]?.rows).toEqual([["field", "type"], ["root_id", "string"]]);
    expect(document.metadata.title).toBe("Ingest Specification");
  });

  it("REG-WU-062-RC-122-a: named references decode in text", () => {
    const document = page("<p>Owner:&nbsp;Mel &mdash; status&nbsp;blocked &rsquo;soon&rsquo;</p>");
    expect(document.blocks.map((block) => block.text))
      .toEqual(["Owner:\u00a0Mel \u2014 status\u00a0blocked \u2019soon\u2019"]);
  });

  it("REG-WU-062-RC-122-b: unknown references stay as written and nothing is decoded twice", () => {
    expect(page("<p>&foo; &amp;nbsp;</p>").blocks.map((block) => block.text)).toEqual(["&foo; &nbsp;"]);
  });

  it("REG-WU-062-RC-122-c: named references decode in attribute values", () => {
    const document = page('<head><meta name="description" content="A&nbsp;B"></head><p>x</p>');
    expect(document.metadata.description).toBe("A\u00a0B");
    expect(tokenizeHtml('<a title="x&mdash;y">')[0]?.attributes.title).toBe("x\u2014y");
  });

  it("REG-WU-062-RC-122-d: numeric references decode as before", () => {
    expect(page("<p>a&#160;b&#x2014;c</p>").blocks.map((block) => block.text)).toEqual(["a\u00a0b\u2014c"]);
  });
});

// ───────────────────────────── WU-063 ─────────────────────────────

function csv(source: string, name = "register.csv"): string {
  const file = path.join(tmp(), name);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

function rowBlocks(document: ReturnType<typeof decoded>) {
  return document.blocks.filter((block) =>
    block.kind === "cell" && block.locator.kind === "csv_row" && block.locator.column === undefined);
}

describe("WU-063 CSV records split after quote-aware parsing", () => {
  it("REG-WU-063-RC-124-a: a quoted newline stays inside its cell and the record keeps its starting line", () => {
    const document = decoded(decode(csv('id,blocker,status\n1,"Waiting on legal,\nthen procurement",blocked\n2,none,done\n')));
    const rows = rowBlocks(document);
    const second = rows.find((block) => block.locator.kind === "csv_row" && block.locator.row_number === 2);
    expect(second?.text).toBe("id: 1; blocker: Waiting on legal,\nthen procurement; status: blocked");
    expect(document.blocks.some((block) => block.text === "status: blocked")).toBe(true);
    const third = rows.find((block) => block.text.startsWith("id: 2"));
    expect(third?.locator).toMatchObject({ kind: "csv_row", row_number: 4 });
    expect(rows.map((block) => block.locator.kind === "csv_row" && block.locator.row_number)).toEqual([1, 2, 4]);
    expect(document.tables[0]?.rows).toEqual([
      ["id", "blocker", "status"],
      ["1", "Waiting on legal,\nthen procurement", "blocked"],
      ["2", "none", "done"],
    ]);
  });

  it("REG-WU-063-RC-124-b: CRLF line endings keep the embedded break and the status", () => {
    const document = decoded(decode(csv('id,blocker,status\r\n1,"Waiting on legal,\r\nthen procurement",blocked\r\n2,none,done\r\n')));
    const cell = document.blocks.find((block) => block.locator.kind === "csv_row" && block.locator.column === "blocker"
      && block.locator.row_number === 2);
    expect(cell?.text).toMatch(/^blocker: Waiting on legal,\r?\nthen procurement$/);
    expect(document.blocks.some((block) => block.text === "status: blocked")).toBe(true);
    const third = rowBlocks(document).find((block) => block.text.startsWith("id: 2"));
    expect(third?.locator).toMatchObject({ row_number: 4 });
  });

  it("REG-WU-063-RC-124-c: an unterminated quote at end of file keeps the rest in one record and says so", () => {
    const document = decoded(decode(csv('id,note\n1,"never closed\n2,still inside\n')));
    const rows = rowBlocks(document);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.text).toBe("id: 1; note: never closed\n2,still inside");
    const note = document.diagnostics.find((diagnostic) => diagnostic.message.includes("quote"));
    expect(note?.severity).toBe("info");
  });

  it("REG-WU-063-RC-124-d: a quoted single-line cell is one cell as before", () => {
    const document = decoded(decode(csv('item,blocker\nlaunch,"Blocked by: procurement, legal"\n')));
    expect(document.tables[0]?.rows[1]).toEqual(["launch", "Blocked by: procurement, legal"]);
    expect(document.blocks.some((block) => block.text === "blocker: Blocked by: procurement, legal")).toBe(true);
  });

  it("REG-WU-063-RC-124-e: blank lines are skipped and row numbers stay physical lines", () => {
    const document = decoded(decode(csv("a,b\n\n1,2\n\n\n3,4\n")));
    expect(rowBlocks(document).map((block) => block.locator.kind === "csv_row" && block.locator.row_number)).toEqual([1, 3, 6]);
  });
});

// ───────────────────────────── WU-064 ─────────────────────────────

function textFile(source: string, name: string): string {
  const file = path.join(tmp(), name);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

function notebook(cells: { cell_type: string; source: string[] | string }[], prefix = ""): string {
  const file = path.join(tmp(), "nb.ipynb");
  const body = JSON.stringify({
    cells: cells.map((cell) => ({ ...cell, metadata: {}, ...(cell.cell_type === "code" ? { outputs: [], execution_count: null } : {}) })),
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  });
  fs.writeFileSync(file, `${prefix}${body}`, "utf8");
  return file;
}

/** The expressions the Markdown classifier used to be, kept as the oracle for ordinary lines. */
const OLD_ATX = /^(#{1,6})\s+(.*\S)\s*#*\s*$/;
const OLD_LIST = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;

describe("WU-064 text and notebook decoders", () => {
  it("REG-WU-064-RC-125-a: a heading marker followed by a long whitespace run decodes in linear time", () => {
    const file = textFile(`#${" ".repeat(1_000_000)}`, "spaces.md");
    const started = Date.now();
    const blocks = decoded(decode(file)).blocks;
    expect(Date.now() - started).toBeLessThan(1000);
    expect(blocks.map((block) => [block.kind, block.text])).toEqual([["paragraph", "#"]]);
  });

  it("REG-WU-064-RC-125-b: a list marker followed by a long tab run decodes in linear time, in Markdown and notebooks", () => {
    const tabs = `-${"\t".repeat(1_000_000)}`;
    const started = Date.now();
    expect(decoded(decode(textFile(tabs, "tabs.md"))).blocks.map((block) => block.kind)).toEqual(["paragraph"]);
    expect(decoded(decode(notebook([{ cell_type: "markdown", source: tabs }]))).blocks.map((block) => block.kind))
      .toEqual(["paragraph"]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("REG-WU-064-RC-125-c: ordinary lines classify exactly as before", () => {
    const lines = ["# T", "###### x", "####### x", "#x", "- a", "* a", "+ a", "1. a", "1) a", "  - a", "-a", "- ", "# ",
      "#\u00a0x", "##\tStatus: WIP", "12. twelve", "1.5 not a list", "- - nested"];
    for (const line of lines) {
      const atx = OLD_ATX.exec(line);
      const list = OLD_LIST.exec(line);
      const expected = atx !== null
        ? [atx[1]?.length === 1 ? "title" : "heading", atx[2]]
        : list !== null
          ? ["list_item", list[1]]
          : ["paragraph", line.trim()];
      const blocks = decoded(decode(textFile(`${line}\n`, "line.md"))).blocks;
      expect(blocks.map((block) => [block.kind, block.text]), JSON.stringify(line)).toEqual([expected]);
    }
  });

  it("REG-WU-064-RC-125-d: a checkbox list item in a notebook keeps its checkbox", () => {
    const blocks = decoded(decode(notebook([{ cell_type: "markdown", source: ["- [ ] finish the retrieval benchmark\n"] }]))).blocks;
    expect(blocks.map((block) => [block.kind, block.text])).toEqual([["list_item", "[ ] finish the retrieval benchmark"]]);
  });

  it("REG-WU-064-RC-126-a: a fence in a notebook markdown cell is a code block cited inside the cell", () => {
    const document = decoded(decode(notebook([
      { cell_type: "markdown", source: ["## Setup\n", "```bash\n", "# install the deps first\n", "pip install -r req.txt\n", "```\n"] },
    ])));
    expect(document.blocks.map((block) => [block.kind, block.text])).toEqual([
      ["heading", "Setup"],
      ["code", "# install the deps first\npip install -r req.txt"],
    ]);
    expect(document.blocks[1]?.locator).toEqual({
      kind: "notebook_cell", cell_index: 0, cell_type: "markdown", line_start: 2, line_end: 5,
    });
    expect(document.blocks.some((block) => block.kind === "title")).toBe(false);
  });

  it("REG-WU-064-RC-126-b: an unclosed fence runs to the end of its cell and is noted", () => {
    const document = decoded(decode(notebook([
      { cell_type: "markdown", source: ["Intro\n", "```\n", "# not a heading"] },
      { cell_type: "markdown", source: ["# Later title"] },
    ])));
    expect(document.blocks.map((block) => [block.kind, block.text])).toEqual([
      ["paragraph", "Intro"],
      ["code", "# not a heading"],
      ["title", "Later title"],
    ]);
    expect(document.blocks[1]?.locator).toMatchObject({ cell_index: 0, line_start: 2, line_end: 3 });
    const note = document.diagnostics.find((diagnostic) => diagnostic.message.includes("fenced code block"));
    expect(note?.severity).toBe("info");
    expect(note?.message).toContain("cell");
  });

  it("REG-WU-064-RC-126-c: the first level-1 heading across the notebook is its only title", () => {
    const document = decoded(decode(notebook([
      { cell_type: "markdown", source: ["# Notebook title\n", "Status: WIP"] },
      { cell_type: "code", source: ["# a comment, not a heading\n", "x = 1"] },
      { cell_type: "markdown", source: ["# Second level one\n", "- [ ] finish"] },
    ])));
    expect(document.blocks.map((block) => [block.kind, block.text])).toEqual([
      ["title", "Notebook title"],
      ["paragraph", "Status: WIP"],
      ["code", "# a comment, not a heading\nx = 1"],
      ["heading", "Second level one"],
      ["list_item", "[ ] finish"],
    ]);
  });

  it("REG-WU-064-RC-126-d: the same Markdown as a .md file decodes to the same kinds and texts", () => {
    const source = "## Setup\n```bash\n# install the deps first\npip install -r req.txt\n```\n";
    const md = decoded(decode(textFile(source, "setup.md"))).blocks.map((block) => [block.kind, block.text]);
    const nb = decoded(decode(notebook([{ cell_type: "markdown", source }]))).blocks.map((block) => [block.kind, block.text]);
    expect(md).toEqual([["heading", "Setup"], ["code", "# install the deps first\npip install -r req.txt"]]);
    expect(nb).toEqual(md);
  });

  it("REG-WU-064-RC-127-a: a byte-order mark does not hide the title on line 1", () => {
    const document = decoded(decode(textFile("\uFEFF# Q3 Plan\n\nBody text\n", "plan.md")));
    expect(document.blocks[0]).toMatchObject({ kind: "title", text: "Q3 Plan", locator: { line_start: 1, line_end: 1 } });
    expect(document.metadata.title).toBe("Q3 Plan");
    expect(document.blocks[1]).toMatchObject({ kind: "paragraph", text: "Body text", locator: { line_start: 3 } });
  });

  it("REG-WU-064-RC-127-b: an ATX closing sequence is not heading text", () => {
    const blocks = decoded(decode(textFile("# Plan\n\n## Status ##\n\n### Owner #   \n", "close.md"))).blocks;
    expect(blocks.map((block) => block.text)).toEqual(["Plan", "Status", "Owner"]);
  });

  it("REG-WU-064-RC-127-c: a '#' not preceded by whitespace stays in the heading", () => {
    const blocks = decoded(decode(textFile("## Status#1\n\n# C#\n", "hash.md"))).blocks;
    expect(blocks.map((block) => block.text)).toEqual(["Status#1", "C#"]);
  });

  it("REG-WU-064-RC-127-d: a notebook with a byte-order mark decodes", () => {
    const outcome = decode(notebook([{ cell_type: "markdown", source: ["# Research\n", "Status: WIP"] }], "\uFEFF"));
    expect(decoded(outcome).blocks.map((block) => block.text)).toEqual(["Research", "Status: WIP"]);
  });

  it("REG-WU-064-RC-127-e: a byte-order mark does not change a CSV's blocks", () => {
    const source = "id,status\n1,blocked\n";
    const plain = decoded(decode(csv(source, "plain.csv")));
    const marked = decoded(decode(csv(`\uFEFF${source}`, "marked.csv")));
    expect(marked.blocks.map((block) => [block.kind, block.text, block.locator]))
      .toEqual(plain.blocks.map((block) => [block.kind, block.text, block.locator]));
    expect(marked.tables.map((table) => table.rows)).toEqual(plain.tables.map((table) => table.rows));
  });
});
