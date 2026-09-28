import { expect, test } from "vitest";
import { LANGUAGES, detectLang, en, translate, type StringKey } from "./strings";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

test("every language has every key, non-empty, with the same placeholders", () => {
  for (const lang of ["si", "ta"] as const) {
    for (const key of Object.keys(en) as StringKey[]) {
      const value = LANGUAGES[lang].strings[key];
      expect(value, `${lang}.${key}`).toBeTruthy();
      expect(placeholders(value), `${lang}.${key}`).toEqual(placeholders(en[key]));
    }
  }
});

test("translate interpolates variables", () => {
  expect(translate("en", "searchResults", { index: 2, count: 5 })).toBe("2 of 5");
  expect(translate("si", "pageOf", { current: 1, total: 9 })).toBe("1 / 9");
});

test("detectLang picks Sinhala and Tamil, else English", () => {
  expect(detectLang("si-LK")).toBe("si");
  expect(detectLang("ta-IN")).toBe("ta");
  expect(detectLang("en-GB")).toBe("en");
  expect(detectLang("fr")).toBe("en");
});
