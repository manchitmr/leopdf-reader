import * as mupdf from "mupdf";
import { utf16Hex } from "./text-writer";
import { legacyScript, tokens, type LegacyScript } from "./legacy";

/*
 * "Convert to Unicode": legacy-font text keeps its look, but each text-showing operator in a legacy font is
 * wrapped in /Span <</ActualText …>> BDC … EMC carrying the Unicode it stands for, so other apps search and
 * copy real Sinhala/Tamil. Content streams are rewritten by inserting bytes around operators; nothing
 * else in them changes.
 */

// ---- a minimal content-stream tokenizer (byte offsets over a Latin-1 view of the stream) ----

type Operand = { kind: "string"; bytes: number[] } | { kind: "name"; value: string } | { kind: "array"; items: Operand[] } | { kind: "other" };
interface Op {
  operator: string;
  operands: Operand[];
  /** Offset of the first operand (or of the operator when there are none). */
  start: number;
  /** Offset just after the operator. */
  end: number;
}

const WHITE = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;

function* operators(src: string): Generator<Op> {
  let i = 0;
  let operands: Operand[] = [];
  let start = -1;
  const stack: Operand[][] = [];
  const arrayStarts: number[] = [];
  const push = (o: Operand, at: number) => {
    if (stack.length) stack[stack.length - 1].push(o);
    else {
      if (!operands.length) start = at;
      operands.push(o);
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (WHITE.test(c)) i++;
    else if (c === "%") while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
    else if (c === "(") {
      const at = i;
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < src.length && depth > 0) {
        const ch = src[i++];
        if (ch === "\\") {
          const n = src[i++];
          const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (n in esc) bytes.push(esc[n]);
          else if (/[0-7]/.test(n)) {
            let oct = n;
            while (oct.length < 3 && /[0-7]/.test(src[i])) oct += src[i++];
            bytes.push(parseInt(oct, 8) & 255);
          } else if (n === "\r") {
            if (src[i] === "\n") i++;
          } else if (n !== "\n") bytes.push(n.charCodeAt(0));
        } else {
          if (ch === "(") depth++;
          if (ch === ")" && --depth === 0) break;
          bytes.push(ch.charCodeAt(0));
        }
      }
      push({ kind: "string", bytes }, at);
    } else if (c === "<" && src[i + 1] === "<") {
      // Inline dictionaries (BDC/DP properties): skip balanced << >>.
      const at = i;
      let depth = 0;
      do {
        if (src.startsWith("<<", i)) (depth++, (i += 2));
        else if (src.startsWith(">>", i)) (depth--, (i += 2));
        else if (src[i] === "(") {
          // a string inside: skip it
          let d = 0;
          do {
            if (src[i] === "\\") i++;
            else if (src[i] === "(") d++;
            else if (src[i] === ")") d--;
            i++;
          } while (d > 0 && i < src.length);
        } else i++;
      } while (depth > 0 && i < src.length);
      push({ kind: "other" }, at);
    } else if (c === "<") {
      const at = i;
      const close = src.indexOf(">", i);
      const hex = src.slice(i + 1, close).replace(/\s/g, "");
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt((hex[k] + (hex[k + 1] ?? "0")), 16));
      push({ kind: "string", bytes }, at);
      i = close + 1;
    } else if (c === "[") {
      arrayStarts.push(i);
      stack.push([]);
      i++;
    } else if (c === "]") {
      const items = stack.pop() ?? [];
      push({ kind: "array", items }, arrayStarts.pop() ?? i);
      i++;
    } else if (c === "/") {
      const at = i;
      i++;
      let name = "";
      while (i < src.length && !WHITE.test(src[i]) && !DELIM.test(src[i])) name += src[i++];
      push({ kind: "name", value: name.replace(/#([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))) }, at);
    } else {
      const at = i;
      let word = "";
      while (i < src.length && !WHITE.test(src[i]) && !DELIM.test(src[i])) word += src[i++];
      if (!word) {
        i++;
        continue;
      }
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) || word === "true" || word === "false" || word === "null") push({ kind: "other" }, at);
      else if (stack.length) stack[stack.length - 1].push({ kind: "other" });
      else {
        yield { operator: word, operands, start: operands.length ? start : at, end: i };
        operands = [];
        // Inline image data is binary: jump past "ID … EI".
        if (word === "ID") {
          const ei = src.slice(i).search(/\sEI(?=[\s]|$)/);
          i = ei < 0 ? src.length : i + ei + 3;
        }
      }
    }
  }
}

// ---- decoding a font's character codes to the (Latin) text legacy fonts were typed as ----

type Decoder = (bytes: number[]) => string;
const winAnsi = new TextDecoder("windows-1252");

/** bfchar / bfrange entries of a ToUnicode CMap. */
function parseToUnicode(cmap: string): { map: Map<number, string>; bytes: number } {
  const map = new Map<number, string>();
  const hexToStr = (h: string) => {
    let s = "";
    for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
    return s;
  };
  const space = /<([0-9a-fA-F]+)>\s*<[0-9a-fA-F]+>/.exec(cmap.slice(cmap.indexOf("begincodespacerange")));
  const bytes = space ? space[1].length / 2 : 1;
  for (const block of cmap.split("beginbfchar").slice(1)) {
    for (const m of block.split("endbfchar")[0].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const block of cmap.split("beginbfrange").slice(1)) {
    const body = block.split("endbfrange")[0];
    for (const m of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const [lo, hi] = [parseInt(m[1], 16), parseInt(m[2], 16)];
      if (m[3].startsWith("[")) {
        [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((d, k) => map.set(lo + k, hexToStr(d[1])));
      } else {
        const first = hexToStr(m[3].slice(1, -1));
        for (let code = lo; code <= hi; code++) map.set(code, first.slice(0, -1) + String.fromCharCode(first.charCodeAt(first.length - 1) + code - lo));
      }
    }
  }
  return { map, bytes };
}

/** How to read a legacy font's strings, or null when the font isn't a convertible legacy font. */
function legacyDecoder(font: mupdf.PDFObject): { script: LegacyScript; decode: Decoder } | null {
  if (!font.isDictionary()) return null;
  const script = legacyScript(font.get("BaseFont").isName() ? font.get("BaseFont").asName() : "");
  if (!script) return null;
  const toUnicode = font.get("ToUnicode");
  const composite = font.get("Subtype").isName() && font.get("Subtype").asName() === "Type0";
  if (toUnicode.isStream()) {
    const parsed = parseToUnicode(toUnicode.readStream().asString());
    const map = parsed.map;
    // Simple fonts always use one-byte codes, whatever the CMap's code space says (Word writes <0000> <FFFF>).
    const bytes = composite ? parsed.bytes : 1;
    return {
      script,
      decode: (b) => {
        let s = "";
        for (let k = 0; k + bytes <= b.length; k += bytes) {
          const code = bytes === 2 ? (b[k] << 8) | b[k + 1] : b[k];
          s += map.get(code) ?? (bytes === 1 ? winAnsi.decode(Uint8Array.of(code)) : "");
        }
        return s;
      },
    };
  }
  // ponytail: simple fonts read as WinAnsi; a /Differences encoding without ToUnicode isn't honoured (none seen yet).
  if (composite) return null;
  return { script, decode: (b) => winAnsi.decode(Uint8Array.from(b)) };
}

// ---- rewriting ----

const SHOW = new Set(["Tj", "TJ", "'", '"']);

function shownBytes(op: Op): number[] {
  const out: number[] = [];
  for (const o of op.operands) {
    if (o.kind === "string") out.push(...o.bytes);
    if (o.kind === "array") for (const item of o.items) if (item.kind === "string") out.push(...item.bytes);
  }
  return out;
}

/** True if `spaced` (the page's text as extracted, with inferred spaces) has a space between these pieces. */
function spacedBetween(spaced: string, before: string, after: string): boolean {
  const tail = before.slice(-6);
  const head = after.slice(0, 6);
  return tail.length > 0 && head.length > 0 && spaced.includes(`${tail} ${head}`) && !spaced.includes(tail + head);
}

interface Shown {
  op: Op;
  script: LegacyScript;
  text: string;
}

/**
 * Wraps legacy-font text in one content stream; returns the new stream text and how many runs were tagged.
 * Programs often split a word over several operators (PowerPoint: one per syllable or two), so the legacy
 * text of consecutive operators is converted as one sequence and each syllable is attached to the operator
 * where it starts; operators whose glyphs are covered elsewhere get an empty ActualText.
 */
export function tagContent(src: string, fontOf: (name: string) => mupdf.PDFObject, spaced = ""): { text: string; count: number } {
  const shown: Shown[][] = [[]];
  const stack: ReturnType<typeof legacyDecoder>[] = [];
  let font: ReturnType<typeof legacyDecoder> = null;
  let inActualText = 0;
  const flush = () => shown[shown.length - 1].length && shown.push([]);
  for (const op of operators(src)) {
    if (op.operator === "q") stack.push(font);
    else if (op.operator === "Q") font = stack.pop() ?? null;
    else if (op.operator === "Tf") {
      const name = op.operands.find((o) => o.kind === "name");
      font = name?.kind === "name" ? legacyDecoder(fontOf(name.value)) : null;
    } else if (op.operator === "BDC" && /ActualText/.test(src.slice(op.start, op.end))) inActualText++;
    else if ((op.operator === "BDC" || op.operator === "BMC") && inActualText) inActualText++;
    else if (op.operator === "EMC" && inActualText) inActualText--;
    else if (SHOW.has(op.operator)) {
      if (!font || inActualText) flush();
      else {
        const run = shown[shown.length - 1];
        if (run.length && run[0].script !== font.script) flush();
        shown[shown.length - 1].push({ op, script: font.script, text: font.decode(shownBytes(op)) });
      }
    }
  }
  const inserts: [number, string][] = [];
  for (const run of shown.filter((r) => r.length)) {
    const unicode = run.map(() => "");
    const ends: number[] = [];
    let offset = 0;
    for (const s of run) ends.push((offset += s.text.length));
    for (const t of tokens(run.map((s) => s.text).join(""), run[0].script)) unicode[ends.findIndex((e) => t.start < e)] += t.unicode;
    // Programs often store no space between words (each word is placed on its own); readers infer one from
    // the gap. Text inside ActualText doesn't get that inference, so keep the spaces MuPDF inferred.
    for (let k = 0; k + 1 < run.length; k++) {
      if (/\s$/.test(run[k].text) || /^\s/.test(run[k + 1].text)) continue;
      if (spacedBetween(spaced, run[k].text, run[k + 1].text)) unicode[k] += " ";
    }
    // Nothing readable came out (unknown encoding): leave the run as it was rather than hide its text.
    if (!unicode.join("").trim()) continue;
    run.forEach((s, k) => inserts.push([s.op.start, `/Span <</ActualText <FEFF${utf16Hex(unicode[k])}>>> BDC `], [s.op.end, " EMC"]));
  }
  let text = src;
  for (const [at, ins] of inserts.sort((a, b) => b[0] - a[0])) text = text.slice(0, at) + ins + text.slice(at);
  return { text, count: inserts.length / 2 };
}

const latin1 = (buf: mupdf.Buffer) => {
  const bytes = buf.asUint8Array();
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};
const fromLatin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** A page attribute, looked up through parent page-tree nodes as the PDF spec allows. */
function inherited(node: mupdf.PDFObject, key: string): mupdf.PDFObject {
  for (let n = node, depth = 0; n.isDictionary() && depth < 32; n = n.get("Parent"), depth++) {
    if (!n.get(key).isNull()) return n.get(key);
  }
  return node.get(key);
}

/** Tags legacy text on a page and in the form XObjects it draws (each stream once). Returns runs tagged. */
export function tagPage(pdf: mupdf.PDFDocument, pageIndex: number, done = new Set<number>()): number {
  const page = pdf.findPage(pageIndex);
  const spaced = pdf.loadPage(pageIndex).toStructuredText("preserve-whitespace").asText().replace(/\s+/g, " ");
  let count = 0;
  const visit = (streams: mupdf.PDFObject[], resources: mupdf.PDFObject) => {
    const fonts = resources.isDictionary() ? resources.get("Font") : null;
    const fontOf = (name: string) => (fonts?.isDictionary() ? fonts.get(name) : pdf.newNull());
    for (const stream of streams) {
      if (stream.isIndirect() && done.has(stream.asIndirect())) continue;
      if (stream.isIndirect()) done.add(stream.asIndirect());
      const tagged = tagContent(latin1(stream.readStream()), fontOf, spaced);
      if (tagged.count) stream.writeStream(fromLatin1(tagged.text));
      count += tagged.count;
    }
    const xobjects = resources.isDictionary() ? resources.get("XObject") : null;
    xobjects?.isDictionary() &&
      xobjects.forEach((x) => {
        if (x.get("Subtype").isName() && x.get("Subtype").asName() === "Form") visit([x], x.get("Resources").isDictionary() ? x.get("Resources") : resources);
      });
  };
  const contents = page.get("Contents");
  const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, i) => contents.get(i)) : contents.isStream() ? [contents] : [];
  visit(streams, inherited(page, "Resources"));
  return count;
}

/** Set on the catalog once converted, so the offer isn't made again (undo removes it). */
const MARK = "LeoPDFUnicode";

/** Tags every page; returns how many text runs were tagged. */
export function convertDocument(pdf: mupdf.PDFDocument): number {
  const done = new Set<number>();
  let count = 0;
  for (let p = 0; p < pdf.countPages(); p++) count += tagPage(pdf, p, done);
  pdf.getTrailer().get("Root").put(MARK, true);
  return count;
}

/** The document has legacy-font text that hasn't been converted yet. */
export const needsUnicode = (pdf: mupdf.PDFDocument) => !pdf.getTrailer().get("Root").get(MARK).isBoolean() && hasLegacyText(pdf);

/** True if any page's fonts include a convertible legacy font. */
export function hasLegacyText(pdf: mupdf.PDFDocument): boolean {
  for (let p = 0; p < pdf.countPages(); p++) {
    let found = false;
    const fonts = inherited(pdf.findPage(p), "Resources").get("Font");
    if (fonts.isDictionary()) fonts.forEach((f) => void (found ||= legacyDecoder(f) !== null));
    if (found) return true;
  }
  return false;
}
