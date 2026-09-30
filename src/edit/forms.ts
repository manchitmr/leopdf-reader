import * as mupdf from "mupdf";
import type { Rect } from "../engine/types";
import type { EmbeddedFonts } from "./embedded-fonts";
import type { ShapedLine } from "./shaper";
import { textContent } from "./text-writer";
import type { FormField, RGB, TextStyle } from "./types";

const KINDS: Record<string, FormField["kind"]> = {
  text: "text", checkbox: "checkbox", radiobutton: "radio", combobox: "choice", listbox: "choice", button: "button", signature: "signature",
};

const idOf = (w: mupdf.PDFWidget) => w.getObject().asIndirect();

export function listFields(page: mupdf.PDFPage, pageIndex: number): FormField[] {
  return page.getWidgets().map((w) => {
    const kind = KINDS[w.getFieldType()] ?? "button";
    const value = w.getValue();
    return {
      id: idOf(w),
      page: pageIndex,
      kind,
      name: w.getName(),
      label: w.getLabel(),
      rect: w.getRect() as Rect,
      value,
      readOnly: w.isReadOnly(),
      multiline: kind === "text" && w.isMultiline(),
      maxLen: kind === "text" ? w.getMaxLen() : 0,
      ...(kind === "choice" ? { options: w.getOptions() } : {}),
      ...(kind === "checkbox" || kind === "radio" ? { checked: value !== "" && value !== "Off" } : {}),
    };
  });
}

export function findWidget(page: mupdf.PDFPage, id: number): mupdf.PDFWidget {
  const widget = page.getWidgets().find((w) => idOf(w) === id);
  if (!widget) throw new Error(`No form field ${id} on this page`);
  if (widget.isReadOnly()) throw new Error(`Form field ${id} is read-only`);
  return widget;
}

/** Font size and colour from the field's default appearance ("/Helv 0 Tf 0 0 1 rg"); size 0 means "fit". */
export function parseDA(da: string): { size: number; color: RGB } {
  const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1] ?? 0);
  const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const gray = /([\d.]+)\s+g(?:\s|$)/.exec(da);
  const color: RGB = rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : gray ? [Number(gray[1]), Number(gray[1]), Number(gray[1])] : [0, 0, 0];
  return { size, color };
}

function defaultAppearance(pdf: mupdf.PDFDocument, widget: mupdf.PDFWidget): string {
  const own = widget.getObject().get("DA");
  if (own.isString()) return own.asString();
  const parent = widget.getObject().get("Parent");
  const inherited = parent.isDictionary() ? parent.get("DA") : null;
  if (inherited?.isString()) return inherited.asString();
  const form = pdf.getTrailer().get("Root").get("AcroForm");
  const da = form.isDictionary() ? form.get("DA") : null;
  return da?.isString() ? da.asString() : "";
}

/** The style text in this field is written with: the field's own size/colour, or a size that fits the box. */
export function fieldStyle(pdf: mupdf.PDFDocument, widget: mupdf.PDFWidget): TextStyle {
  const { size, color } = parseDA(defaultAppearance(pdf, widget));
  const [, y0, , y1] = widget.getRect();
  const fit = widget.isMultiline() ? 12 : Math.max(6, Math.min(12, (y1 - y0) * 0.6));
  return { family: "sans", bold: false, size: size > 0 ? size : fit, color };
}

/** Largest size ≤ style.size at which every line fits the field's width (single-line auto-size fields). */
/** Whether the field asks for automatic font size (DA size 0). */
export const autoSized = (pdf: mupdf.PDFDocument, widget: mupdf.PDFWidget) => parseDA(defaultAppearance(pdf, widget)).size === 0;

export function fitToWidth(lines: ShapedLine[], size: number, width: number): number {
  const widest = Math.max(0, ...lines.map((l) => l.width));
  return widest > width && widest > 0 ? Math.max(4, (size * width) / widest) : size;
}

/**
 * Stores the value and draws its appearance with shaped text. MuPDF's own appearance uses a font with no
 * Sinhala/Tamil glyphs, so the characters would be dropped.
 */
export function writeTextField(
  pdf: mupdf.PDFDocument,
  page: mupdf.PDFPage,
  widget: mupdf.PDFWidget,
  value: string,
  lines: ShapedLine[],
  style: TextStyle,
  fonts: EmbeddedFonts,
): void {
  widget.setTextValue(value);
  page.update(); // let MuPDF finish its own appearance first, so it doesn't overwrite ours later
  const [x0, y0, x1, y1] = widget.getRect();
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = 2;
  const lineHeight = style.size * 1.2;
  // Single line: centred vertically. Multiline: from the top.
  const firstBaseline = widget.isMultiline() ? h - pad - style.size * 0.95 : (h - style.size) / 2 + style.size * 0.22;
  const resources = pdf.newDictionary();
  const fontDict = pdf.newDictionary();
  resources.put("Font", fontDict);
  const body = value
    ? textContent(
        { lines, size: style.size, color: style.color, lineMatrix: (i) => [1, 0, 0, 1, pad, firstBaseline - i * lineHeight] },
        (run) => {
          const use = fonts.use(run.font);
          fontDict.put(use.resourceName, use.ref);
          return use;
        },
      )
    : "";
  const dict = pdf.newDictionary();
  dict.put("Type", pdf.newName("XObject"));
  dict.put("Subtype", pdf.newName("Form"));
  const bbox = pdf.newArray();
  [0, 0, w, h].forEach((n) => bbox.push(n));
  dict.put("BBox", bbox);
  dict.put("Resources", resources);
  const stream = pdf.addStream(`/Tx BMC q 0 0 ${w} ${h} re W n\n${body}Q EMC\n`, dict);
  const ap = pdf.newDictionary();
  ap.put("N", stream);
  widget.getObject().put("AP", ap);
  // Other viewers must use this appearance instead of drawing the value with their own fonts.
  const form = pdf.getTrailer().get("Root").get("AcroForm");
  if (form.isDictionary()) form.delete("NeedAppearances");
}

export function setChecked(page: mupdf.PDFPage, widget: mupdf.PDFWidget, checked: boolean): void {
  const on = !["", "Off"].includes(widget.getValue());
  if (on !== checked) widget.toggle();
  page.update();
}

export function setChoice(page: mupdf.PDFPage, widget: mupdf.PDFWidget, value: string): void {
  widget.setChoiceValue(value);
  page.update();
}

/** True if the document has an interactive form with at least one field. */
export function hasForm(doc: mupdf.PDFDocument): boolean {
  const form = doc.getTrailer().get("Root").get("AcroForm");
  if (!form.isDictionary()) return false;
  const fields = form.get("Fields");
  return fields.isArray() && fields.length > 0;
}
