import { expect, test } from "vitest";
import { baseName, isPdfName } from "./sources";

test("baseName handles POSIX and Windows paths", () => {
  expect(baseName("/Users/a/Docs/file.pdf")).toBe("file.pdf");
  expect(baseName("C:\\Users\\a\\file.pdf")).toBe("file.pdf");
});

test("isPdfName is case-insensitive", () => {
  expect(isPdfName("A.PDF")).toBe(true);
  expect(isPdfName("a.txt")).toBe(false);
});
