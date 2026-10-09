# Chrome Web Store listing — copy & paste

## Store listing tab

**Name** (from manifest): Auto-Prompter for Gemini

**Summary** (max 132 chars, from manifest):
Send a list of prompts to Gemini automatically, with loops, custom delays, limit-aware pauses and alerts.

**Category:** Productivity → Tools  (or "Workflow & Planning")

**Language:** English

**Description:**

Auto-Prompter for Gemini sends your prompts to Gemini one after another, so you don't have to sit and type them.

Press play, and it types each prompt into Gemini, waits for the full reply, waits the delay you chose, then sends the next one. Press stop at any time.

★ Three ways to add prompts
• Built-in list, ready to go
• Upload a .txt file. Put an empty line between prompts, and a prompt can span several lines
• Write or paste prompts directly in the extension

★ Choose how long it runs
• Infinite: loops until you stop it
• Count: runs the whole list a set number of times
• Until: stops at a time you pick

★ Your pace
• Fixed delay or a random range between prompts
• Type any value in seconds or minutes, or tap a preset
• Change the delay while it's running, or skip a wait

★ Respects Gemini's limits
If Gemini says you've sent too many prompts, Auto-Prompter backs off. It pauses for 5 minutes, then waits longer each time it happens again, up to 1 hour. Then it retries the same prompt, so nothing is skipped.

★ Never miss a stop
If it stops unexpectedly because of an error, a closed tab or an unresponsive page, you get a desktop notification and an alert on the Gemini page with a one-click Resume.

★ Clean, modern design
Live countdown ring, progress through your list, stats and recent activity. Works in light and dark mode.

Privacy: everything stays in your browser. No accounts, no tracking, no data sent anywhere.

Please use it responsibly and within Google's terms and usage limits.

Auto-Prompter for Gemini is an independent tool. It is not made, endorsed or sponsored by Google. "Gemini" and "Google" are trademarks of Google LLC.

**Graphics** (in `store/graphics/`):
- Store icon: `icon-128.png` (128×128)
- Screenshots (1280×800): `screenshot-1.png` … `screenshot-3.png`
- Small promo tile (440×280): `promo-small-440x280.png`

## Privacy practices tab

**Single purpose description:**
Automatically sends a user-provided list of prompts to Gemini (gemini.google.com) in sequence, with user-controlled loops and delays.

**Permission justifications:**
- `storage`: Saves the user's prompts, settings and run progress locally so automation can continue after the popup closes or the page reloads.
- `notifications`: Shows a desktop notification when automation stops unexpectedly (error, closed tab, unresponsive page), hits Gemini's usage limit, or finishes.
- `alarms`: Runs a once-a-minute check while automation is on, to detect a stalled Gemini page and alert the user.
- Host permission `https://gemini.google.com/*`: Needed to type the user's prompts into Gemini, click send, detect when the reply has finished, and show an on-page status indicator. No other sites are accessed.

**Remote code:** No, I am not using remote code. (All code is packaged in the extension.)

**Data usage:** tick **none** of the data types. The extension does not collect or transmit user data.
Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** host `store/privacy-policy.html` publicly and paste its link (see README steps).

## Distribution tab
- Visibility: Public (or Unlisted for testing first)
- Regions: All regions
- Price: Free
