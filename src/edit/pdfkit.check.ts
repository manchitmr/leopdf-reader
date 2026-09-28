import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CORPUS, writeBlankPdf } from "./roundtrip.test";

// macOS only: measures how Preview's engine (PDFKit) extracts LeoPDF-written text.
// Writes the report to $TMPDIR/leopdf-pdfkit-report.txt.
test.runIf(process.platform === "darwin")("PDFKit extraction report", async () => {
  const pdf = join(tmpdir(), "leopdf-pdfkit-check.pdf");
  writeFileSync(pdf, await writeBlankPdf(CORPUS, { family: "sans", bold: false, size: 14, color: [0, 0, 0] }));
  const report = execFileSync("swift", ["scripts/pdfkit-check.swift", pdf, ...CORPUS], { encoding: "utf8" });
  writeFileSync(join(tmpdir(), "leopdf-pdfkit-report.txt"), report);
  expect(report).toMatch(/PDFKit: exact lines \d+\/\d+, words found \d+\/\d+/);
}, 300_000);
