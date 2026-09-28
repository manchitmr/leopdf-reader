#!/usr/bin/env bash
# Regenerates test PDFs. Uses headless Chrome because its PDF writer emits
# correct ToUnicode maps for shaped Sinhala/Tamil text (MuPDF's writer does not).
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --generate-pdf-document-outline \
  --print-to-pdf=tests/fixtures/sample-si-ta.pdf "file://$PWD/tests/fixtures/sample-si-ta.html"
