import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import { DocumentEditor } from "./editor";
import { FontRegistry } from "./font-registry";
import { parseDA } from "./forms";
import { nodeFontSource } from "./node-font-source";

mupdf.setLog({ warning: () => {}, error: () => {} });
const registry = new FontRegistry(nodeFontSource);

/** A one-page fillable form: auto-size text field, fixed-size multiline field, checkbox, combo box. */
function makeForm(): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const res = doc.addObject(doc.newDictionary());
  res.put("Font", doc.newDictionary());
  res.get("Font").put("Helv", helv);
  doc.insertPage(-1, doc.addPage([0, 0, 400, 300], 0, res, "BT /Helv 12 Tf 20 250 Td (Name:) Tj ET"));
  const pageRef = doc.findPage(0);
  const annots = doc.newArray();
  const fields = doc.newArray();
  const add = (entries: Record<string, unknown>, rect: number[]) => {
    const o = doc.addObject(doc.newDictionary());
    o.put("Type", doc.newName("Annot"));
    o.put("Subtype", doc.newName("Widget"));
    o.put("P", pageRef);
    o.put("F", 4);
    const r = doc.newArray();
    rect.forEach((n) => r.push(n));
    o.put("Rect", r);
    for (const [k, v] of Object.entries(entries)) o.put(k, v as mupdf.PDFObject);
    annots.push(o);
    fields.push(o);
  };
  add({ FT: doc.newName("Tx"), T: doc.newString("name"), DA: doc.newString("/Helv 0 Tf 0 g") }, [80, 240, 380, 265]);
  add({ FT: doc.newName("Tx"), T: doc.newString("address"), DA: doc.newString("/Helv 10 Tf 0 0 1 rg"), Ff: 4096 }, [80, 150, 380, 230]);
  add({ FT: doc.newName("Btn"), T: doc.newString("agree"), V: doc.newName("Off"), AS: doc.newName("Off") }, [80, 120, 95, 135]);
  const opt = doc.newArray();
  ["කොළඹ", "யாழ்ப்பாணம்", "Galle"].forEach((o) => opt.push(doc.newString(o)));
  add({ FT: doc.newName("Ch"), T: doc.newString("city"), Ff: 131072, Opt: opt, DA: doc.newString("/Helv 10 Tf 0 g") }, [80, 80, 200, 100]);
  pageRef.put("Annots", annots);
  const form = doc.newDictionary();
  form.put("Fields", fields);
  form.put("NeedAppearances", true);
  const dr = doc.newDictionary();
  dr.put("Font", doc.newDictionary());
  dr.get("Font").put("Helv", helv);
  form.put("DR", dr);
  doc.getTrailer().get("Root").put("AcroForm", form);
  return new mupdf.PDFDocument(doc.saveToBuffer("").asUint8Array().slice());
}

let pdf: mupdf.PDFDocument;
let editor: DocumentEditor;
beforeEach(() => {
  pdf = makeForm();
  editor = new DocumentEditor(pdf, registry);
});
const reopen = () => new mupdf.PDFDocument(editor.save());
const pageText = (doc: mupdf.PDFDocument) => doc.loadPage(0).toStructuredText("preserve-whitespace").asText();

test("parses the default appearance", () => {
  expect(parseDA("/Helv 0 Tf 0 g")).toEqual({ size: 0, color: [0, 0, 0] });
  expect(parseDA("/Helv 10 Tf 0 0 1 rg")).toEqual({ size: 10, color: [0, 0, 1] });
});

test("lists fields with kind, value and options", () => {
  const fields = editor.listFields(0);
  expect(fields.map((f) => [f.kind, f.name])).toEqual([["text", "name"], ["text", "address"], ["checkbox", "agree"], ["choice", "city"]]);
  expect(fields[1].multiline).toBe(true);
  expect(fields[2].checked).toBe(false);
  expect(fields[3].options).toEqual(["කොළඹ", "யாழ்ப்பாணம்", "Galle"]);
});

test("Sinhala/Tamil typed into a field is stored, drawn shaped, and extracts exactly after saving", async () => {
  const [name, address] = editor.listFields(0);
  await editor.fillText(0, name.id, "ශ්‍රී ලංකාව Colombo");
  await editor.fillText(0, address.id, "யாழ்ப்பாணம்\nவடக்கு மாகாணம்");
  expect(editor.listFields(0)[0].value).toBe("ශ්‍රී ලංකාව Colombo");
  const saved = reopen();
  // Text extraction skips form fields; flattening a copy shows what copy/search see once baked in.
  const flat = reopen();
  flat.bake(true, true);
  const text = pageText(flat);
  expect(text).toContain("ශ්‍රී ලංකාව Colombo");
  expect(text).toContain("யாழ்ப்பாணம்");
  expect(text).toContain("வடக்கு மாகாணம்");
  expect(saved.getTrailer().get("Root").get("AcroForm").get("NeedAppearances").isNull()).toBe(true);
  // Reopened, the value is still there for form software.
  expect(saved.loadPage(0).getWidgets()[0].getValue()).toBe("ශ්‍රී ලංකාව Colombo");
});

test("a long value in an auto-size field shrinks to fit", async () => {
  const [name] = editor.listFields(0);
  await editor.fillText(0, name.id, "ශ්‍රී ලංකා ප්‍රජාතාන්ත්‍රික සමාජවාදී ජනරජය — Democratic Socialist Republic");
  const ap = pdf.loadPage(0).getWidgets()[0].getObject().get("AP").get("N").readStream().asString();
  const size = Number(/ ([\d.]+) Tf/.exec(ap)![1]);
  expect(size).toBeLessThan(12);
});

test("checkbox and choice; every fill is undoable", async () => {
  const [, , agree, city] = editor.listFields(0);
  await editor.setFieldChecked(0, agree.id, true);
  await editor.setFieldChoice(0, city.id, "Galle");
  expect(editor.listFields(0)[2].checked).toBe(true);
  expect(editor.listFields(0)[3].value).toBe("Galle");
  editor.undo();
  expect(editor.listFields(0)[3].value).not.toBe("Galle");
  editor.undo();
  expect(editor.listFields(0)[2].checked).toBe(false);
});
