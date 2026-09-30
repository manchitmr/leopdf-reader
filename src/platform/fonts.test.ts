import { expect, test } from "vitest";
import { faceOf, findInstalled, installHint, type SystemFont } from "./fonts";

const font = (family: string, postscript: string, bold = false, italic = false): SystemFont => ({
  path: `/fonts/${postscript}.ttf`, index: 0, family, postscript, bold, italic, sinhala: true, tamil: false,
});
const fonts = [
  font("Iskoola Pota", "IskoolaPota"),
  font("Iskoola Pota", "IskoolaPota-Bold", true),
  font("Times New Roman", "TimesNewRomanPSMT"),
  font("Times New Roman", "TimesNewRomanPS-ItalicMT", false, true),
  font("Latha", "Latha"),
];

test.each([
  ["XQTPST+IskoolaPota-Bold", true, "IskoolaPota-Bold"],
  ["ABCDEE+Iskoola Pota,Bold", true, "IskoolaPota-Bold"],
  ["IRGDQX+IskoolaPota", false, "IskoolaPota"],
  ["BAAAAA+TimesNewRomanPSMT", false, "TimesNewRomanPSMT"],
  ["BCDGEE+Latha-Bold", true, "Latha"], // no bold face installed → regular (bold is synthesised)
])("%s (bold %s) → %s", (pdfName, bold, postscript) => {
  expect(findInstalled(fonts, pdfName, bold, false)?.postscript).toBe(postscript);
});

test("fonts that aren't installed, and legacy/unknown names, find nothing", () => {
  expect(findInstalled(fonts, "BCDKEE+Vijaya", false, false)).toBeUndefined();
  expect(findInstalled(fonts, "", false, false)).toBeUndefined();
});

test("faceOf picks the exact style, else regular", () => {
  expect(faceOf(fonts, "Times New Roman", false, true)?.postscript).toBe("TimesNewRomanPS-ItalicMT");
  expect(faceOf(fonts, "Times New Roman", true, false)?.postscript).toBe("TimesNewRomanPSMT");
});

test("install hints for Windows optional font packs", () => {
  expect(installHint("XQTPST+IskoolaPota-Bold")).toBe("hintSinhalaFonts");
  expect(installHint("BCDKEE+Vijaya")).toBe("hintTamilFonts");
  expect(installHint("Calibri")).toBeNull();
});
