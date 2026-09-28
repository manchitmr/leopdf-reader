// Usage: swift scripts/pdfkit-check.swift file.pdf "expected line 1" "expected line 2" ...
// Prints how many expected lines PDFKit extracts exactly and how many words it can find.
import PDFKit
let args = Array(CommandLine.arguments.dropFirst())
guard let path = args.first, let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { print("cannot open"); exit(1) }
let lines = Array(args.dropFirst())
let text = (0..<doc.pageCount).compactMap { doc.page(at: $0)?.string }.joined(separator: "\n")
var exact = 0, words = 0, found = 0
for line in lines {
  if text.contains(line) { exact += 1 }
  for w in line.split(separator: " ") { words += 1; if !doc.findString(String(w), withOptions: []).isEmpty { found += 1 } }
}
print("PDFKit: exact lines \(exact)/\(lines.count), words found \(found)/\(words)")
