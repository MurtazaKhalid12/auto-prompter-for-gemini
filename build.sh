#!/usr/bin/env bash
# Builds the zip to upload to the Chrome Web Store: dist/auto-prompter-for-gemini-<version>.zip
set -euo pipefail
cd "$(dirname "$0")"

version=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
out="dist/auto-prompter-for-gemini-${version}.zip"

mkdir -p dist
rm -f "$out"
zip -r -X "$out" \
  manifest.json background.js content.js prompts.js \
  popup.html popup.css popup.js \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  LICENSE >/dev/null

cp "$out" dist/auto-prompter-for-gemini.zip  # stable name for the "latest" download link

echo "Built $out"
unzip -l "$out"
