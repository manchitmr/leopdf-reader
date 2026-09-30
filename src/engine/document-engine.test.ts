import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
import { nodeFontSource } from "../edit/node-font-source";
import { DocumentEngine } from "./document-engine";

const fixture = new Uint8Array(readFileSync(new URL("../../tests/fixtures/sample-si-ta.pdf", import.meta.url)));

function encryptedFixture(): Uint8Array {
  const doc = mupdf.Document.openDocument(fixture, "application/pdf").asPDF()!;
  return doc.saveToBuffer("encrypt=aes-256,user-password=secret,owner-password=owner").asUint8Array().slice();
}

let engine: DocumentEngine;
beforeEach(() => {
  engine = new DocumentEngine();
});

test("opens the fixture with pages and outline", () => {
  const r = engine.open("a", fixture);
  expect(r.status).toBe("ok");
  if (r.status !== "ok") return;
  expect(r.info.pageCount).toBe(2);
  expect(r.info.pages[0].label).toBe("1");
  expect(r.info.outline.map((o) => [o.title, o.page])).toEqual([
    ["Chapter One", 0],
    ["Chapter Two", 1],
  ]);
  expect(r.info.repaired).toBe(false);
});

test("renders RGBA pixels with a white background", () => {
  engine.open("a", fixture);
  const page = engine.render("a", 0, 1, 0);
  expect(page.pixels.length).toBe(page.width * page.height * 4);
  expect(Array.from(page.pixels.slice(0, 4))).toEqual([255, 255, 255, 255]);
});

test("rotation by 90 swaps width and height", () => {
  engine.open("a", fixture);
  const upright = engine.render("a", 0, 0.5, 0);
  const turned = engine.render("a", 0, 0.5, 90);
  expect([turned.width, turned.height]).toEqual([upright.height, upright.width]);
});

test("renderPng returns PNG bytes", () => {
  engine.open("a", fixture);
  const png = engine.renderPng("a", 0, 0.5);
  expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
});

test("search is Unicode-normalised across Sinhala, Tamil and Latin", () => {
  engine.open("a", fixture);
  expect(engine.search("a", "ශ්රී")).toHaveLength(1);
  expect(engine.search("a", "யாழ்ப்பாணம்")).toHaveLength(1);
  expect(engine.search("a", "hello")).toHaveLength(1);
  expect(engine.search("a", "second page")[0].page).toBe(1);
  expect(engine.search("a", "")).toEqual([]);
});

test("select returns text and rects between two page points", () => {
  engine.open("a", fixture);
  const sel = engine.select("a", 0, [0, 0], [600, 120]);
  expect(sel.text).toContain("Hello world");
  expect(sel.rects.length).toBeGreaterThan(0);
});

test("password-protected PDF needs a password and rejects a wrong one", () => {
  expect(engine.open("p", encryptedFixture())).toEqual({ status: "needs-password" });
  expect(engine.unlock("p", "nope")).toEqual({ status: "wrong-password" });
  const ok = engine.unlock("p", "secret");
  expect(ok.status === "ok" && ok.info.pageCount).toBe(2);
});

test("garbage bytes report a corrupt document", () => {
  expect(engine.open("g", new TextEncoder().encode("not a pdf"))).toEqual({ status: "error", reason: "corrupt" });
});

test("a truncated PDF opens and is flagged as repaired", () => {
  const r = engine.open("t", fixture.slice(0, 20000));
  expect(r.status).toBe("ok");
  expect(r.status === "ok" && r.info.repaired).toBe(true);
});

test("closed documents are forgotten", () => {
  engine.open("a", fixture);
  engine.close("a");
  expect(() => engine.render("a", 0, 1, 0)).toThrow("Unknown document a");
});

test("a document with no pages is reported as corrupt", () => {
  expect(engine.open("z", fixture.slice(0, 500))).toEqual({ status: "error", reason: "corrupt" });
});

test("search can be limited to a page range", () => {
  engine.open("a", fixture);
  expect(engine.search("a", "chapter", 0, 1).map((h) => h.page)).toEqual([0]);
  expect(engine.search("a", "chapter", 1, 2).map((h) => h.page)).toEqual([1]);
  expect(engine.search("a", "chapter", 1, 99).map((h) => h.page)).toEqual([1]);
});

test("documents report whether they can be edited and whether they are signed", () => {
  const r = engine.open("a", fixture);
  expect(r.status === "ok" && r.info.editable).toBe(true);
  expect(r.status === "ok" && r.info.signed).toBe(false);
});

test("edits go through the engine and invalidate cached text", async () => {
  const e = new DocumentEngine({ fontSource: nodeFontSource });
  e.open("a", fixture);
  expect(e.search("a", "යාපනය")).toEqual([]);
  const r = await e.addText("a", 0, [72, 400], "Jaffna යාපනය", { family: "sans", bold: false, size: 14, color: [0, 0, 0] });
  expect(r.history.dirty).toBe(true);
  expect(e.search("a", "යාපනය")).toHaveLength(1);
  expect(e.listObjects("a", 0)).toHaveLength(1);
  await e.undo("a");
  expect(e.search("a", "යාපනය")).toEqual([]);
  const saved = e.save("a");
  expect(saved.length).toBeGreaterThan(1000);
  expect(e.markSaved("a").dirty).toBe(false);
});

test("history of a document never edited is clean", () => {
  engine.open("a", fixture);
  expect(engine.history("a")).toEqual({ canUndo: false, canRedo: false, dirty: false });
});

test("annotations are added, listed per page and for the whole document", async () => {
  const r = engine.open("a", fixture);
  expect(r.status === "ok" && r.info.annotatable).toBe(true);
  expect(engine.listAnnotations("a")).toEqual([]);
  await engine.addAnnotation("a", 1, { kind: "note", at: [100, 100], contents: "யாழ்ப்பாணம்" }, "Leo");
  expect(engine.listAnnotations("a", 0)).toEqual([]);
  expect(engine.listAnnotations("a").map((x) => [x.page, x.kind, x.contents])).toEqual([[1, "note", "யாழ்ப்பாணம்"]]);
  expect(engine.history("a").dirty).toBe(true);
});

test("the outline is read fresh after bookmark edits", async () => {
  engine.open("a", fixture);
  await engine.addBookmark("a", 0, "කොළඹ");
  expect(engine.outline("a").map((n) => [n.title, n.page, n.path])).toEqual([
    ["Chapter One", 0, [0]],
    ["Chapter Two", 1, [1]],
    ["කොළඹ", 0, [2]],
  ]);
  await engine.deleteBookmark("a", [2]);
  expect(engine.outline("a")).toHaveLength(2);
});

test("page operations and their undo report the new page list; search sees the new order", async () => {
  engine.open("a", fixture);
  const blank = await engine.insertBlankPage("a", 0);
  expect(blank.info?.pageCount).toBe(3);
  expect(blank.pages).toEqual([0]);
  const rotated = await engine.rotatePages("a", [1], 90);
  expect(rotated.info!.pages[1].bounds[2]).toBeGreaterThan(rotated.info!.pages[1].bounds[3]); // now landscape
  expect(engine.search("a", "Hello world").map((h) => h.page)).toEqual([1]);
  const undone = await engine.undo("a");
  expect(undone.info?.pageCount).toBe(3);
  const undone2 = await engine.undo("a");
  expect(undone2.info?.pageCount).toBe(2);
  expect(engine.search("a", "Hello world").map((h) => h.page)).toEqual([0]);
  const parts = engine.splitEvery("a", 1);
  expect(parts).toHaveLength(2);
  expect(mupdf.Document.openDocument(engine.extractPages("a", [1, 0]), "application/pdf").countPages()).toBe(2);
});
