import { expect, test } from "vitest";
import { ensurePdfName } from "./files";

test("ensurePdfName adds .pdf when missing", () => {
  expect(ensurePdfName("report")).toBe("report.pdf");
  expect(ensurePdfName("report.PDF")).toBe("report.PDF");
  expect(ensurePdfName("යාපනය.pdf")).toBe("යාපනය.pdf");
});
