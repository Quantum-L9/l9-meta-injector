// document_markup_fidelity.test.ts — decoded text equals document text.
//
// The decoders in src/documents read markup (OOXML parts, HTML pages), delimited
// text and notebooks. Each case here pins one way the decoded text used to drift
// from what the document says: fused words, harvested markup, a tag that ended
// inside an attribute value. Test names carry the regression id they discharge.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_DECODER_BUDGET,
  DecodeInput,
  XmlEvent,
  defaultDecoderRegistry,
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
