// Auto-Prompter for Gemini — Copyright (c) 2026 Murtaza Khalid. All rights reserved.

// ─────────────────────────────────────────────────────────────
//  Built-in prompts (the "Built-in" source in the popup).
//  Edit this list, then click the reload icon on the extension
//  card in brave://extensions.
//  They are sent in order, top to bottom, then it loops back.
// ─────────────────────────────────────────────────────────────
const PROMPTS = [
  "Give me one interesting fact about space.",
  "Explain a random concept from computer science in 3 sentences.",
  "Suggest a healthy breakfast idea with ingredients.",
  "Write a short motivational quote and explain its meaning.",
  "Tell me about a historical event that happened on this day.",
  "Give me a productivity tip I can apply today.",
  "Recommend a book and summarize it in two sentences.",
  "Teach me one useful word in Spanish with an example sentence.",
];

// Default delay (seconds) between prompts. Can be changed from the popup.
const DEFAULT_MIN_DELAY = 15;
const DEFAULT_MAX_DELAY = 15;

// Splits text into prompts: an empty line separates one prompt from the
// next, so a single prompt can span several lines.
function parsePrompts(text) {
  return (text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
