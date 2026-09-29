import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import { addBookmark, deleteBookmark, listOutline, renameBookmark } from "./bookmarks";

mupdf.setLog({ warning: () => {}, error: () => {} });
const FIXTURE = readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url));

let pdf: mupdf.PDFDocument;
beforeEach(() => {
  pdf = new mupdf.PDFDocument(FIXTURE);
});
const titles = (doc: mupdf.Document = pdf) => listOutline(doc).map((n) => [n.title, n.page, n.path]);

test("the outline lists titles, pages and paths", () => {
  expect(titles()).toEqual([
    ["Chapter One", 0, [0]],
    ["Chapter Two", 1, [1]],
  ]);
});

test("a new bookmark goes at the end, points at its page and survives save", () => {
  expect(addBookmark(pdf, 1, "ශ්‍රී ලංකාව — யாழ்ப்பாணம்")).toEqual([2]);
  const saved = new mupdf.PDFDocument(pdf.saveToBuffer("").asUint8Array().slice());
  expect(titles(saved)[2]).toEqual(["ශ්‍රී ලංකාව — யாழ்ப்பாணம்", 1, [2]]);
});

test("a document without bookmarks gets its first one", () => {
  const blank = new mupdf.PDFDocument();
  blank.insertPage(-1, blank.addPage([0, 0, 100, 100], 0, blank.newDictionary(), ""));
  expect(addBookmark(blank, 0, "Colombo")).toEqual([0]);
  expect(titles(blank)).toEqual([["Colombo", 0, [0]]]);
});

test("bookmarks can be renamed and deleted by path; unknown paths throw", () => {
  renameBookmark(pdf, [1], "කොළඹ");
  deleteBookmark(pdf, [0]);
  expect(titles()).toEqual([["කොළඹ", 1, [0]]]);
  expect(() => renameBookmark(pdf, [5], "x")).toThrow("No bookmark at 5");
  expect(() => deleteBookmark(pdf, [0, 0])).toThrow("No bookmark at 0.0");
});
