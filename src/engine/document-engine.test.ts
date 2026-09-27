import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { beforeEach, expect, test } from "vitest";
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
  expect(engine.search("a", "தமிழ்")).toHaveLength(1);
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
