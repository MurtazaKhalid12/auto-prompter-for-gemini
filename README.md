# Auto-Prompter for Gemini

Copyright (c) 2026 Murtaza Khalid. All rights reserved. See [LICENSE](LICENSE).

A free browser extension that sends a list of prompts to Gemini automatically, with loops, custom delays, pauses when Gemini's usage limit is hit, and alerts when it stops.

**Website & download:** https://murtazakhalid12.github.io/auto-prompter-for-gemini/

## Install (free)

1. Download [auto-prompter-for-gemini.zip](https://github.com/MurtazaKhalid12/auto-prompter-for-gemini/releases/latest/download/auto-prompter-for-gemini.zip) and extract it into a folder you'll keep.
2. Open `brave://extensions`, `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder (the one with `manifest.json`).
5. Pin the extension, open [gemini.google.com](https://gemini.google.com), click the icon and press play.

**To update:** download the new zip, replace the files in your folder, then click the reload ↻ icon on the extension.

## Project layout

| Path | What it is |
|---|---|
| `manifest.json`, `*.js`, `popup.*`, `icons/` | The extension itself |
| `LICENSE` | Proprietary licence (free to use, no copying or redistribution) |
| `build.sh` | Builds the upload zip into `dist/` |
| `docs/` | GitHub Pages website (landing page + privacy policy) |
| `store/LISTING.md` | All text for the Chrome Web Store dashboard |
| `store/privacy-policy.html` | Privacy policy page, which you need to host publicly |
| `store/graphics/` | Store icon, screenshots and promo tile |

## Releasing a new version on GitHub
1. Raise `"version"` in `manifest.json`, run `./build.sh`.
2. Update the version shown in `docs/index.html`, commit and push.
3. `gh release create vX.Y.Z dist/auto-prompter-for-gemini.zip dist/auto-prompter-for-gemini-X.Y.Z.zip --title "vX.Y.Z" --notes "What changed"`.

## Publishing to the Chrome Web Store (optional, US$5 one-time fee)

1. **Build the zip:** `./build.sh` creates `dist/auto-prompter-for-gemini-<version>.zip`.
2. **Developer account:** go to https://chrome.google.com/webstore/devconsole, sign in with the Google account you want to publish under, and pay the one-time US$5 registration fee. Verify your contact email.
3. **Host the privacy policy:**
   - Open `store/privacy-policy.html` and replace `REPLACE_WITH_YOUR_EMAIL` with your contact email.
   - Publish the file publicly. The easiest ways are a public GitHub repo with GitHub Pages enabled, or a Google Sites page with the same text.
   - Copy the public URL.
4. **New item:** click **New item** and upload the zip.
5. **Store listing tab:** paste the description, category and language from `store/LISTING.md`. Upload `store/graphics/icon-128.png`, the 3 screenshots and the small promo tile.
6. **Privacy practices tab:** paste the single-purpose text and each permission justification from `store/LISTING.md`. Answer "No remote code" and tick no data types. Tick the three certifications and paste your privacy policy URL.
7. **Distribution tab:** set it to Free, all regions. Choose Public, or Unlisted if you want to test the store version privately first.
8. **Submit for review.** Reviews usually take a few days; you'll get an email with the result.

### Releasing an update
Raise `"version"` in `manifest.json` (for example 1.0.0 → 1.0.1), run `./build.sh`, then open the item in the dashboard. Upload the new zip under **Package**, and submit again.

## Testing locally
Open `brave://extensions` (or `chrome://extensions`), turn on Developer mode, click **Load unpacked**, and select this folder.
