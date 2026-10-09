// Auto-Prompter for Gemini — Copyright (c) 2026 Murtaza Khalid. All rights reserved.
// Licensed under the terms in the LICENSE file. Not affiliated with Google.

const STALL_LIMIT = 2 * 60 * 1000; // no heartbeat for 2 min while running = stalled

// ── messages from content scripts ────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "whoami") {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null });
  } else if (msg.type === "alert") {
    notify(msg.title, msg.message, msg.kind);
  }
});

// ── desktop notifications ────────────────────────────────────
async function notify(title, message, kind = "error") {
  const { notify: enabled } = await chrome.storage.local.get("notify");
  if (enabled === false) return;
  chrome.notifications.create("ap-" + Date.now(), {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: kind === "done" ? 0 : 2,
    requireInteraction: kind !== "done",
  });
}

// Clicking a notification brings the Gemini tab to the front.
chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const { targetTabId } = await chrome.storage.local.get("targetTabId");
  if (targetTabId == null) return;
  try {
    const tab = await chrome.tabs.get(targetTabId);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // tab is gone
  }
});

async function stopWithError(message) {
  await chrome.storage.local.set({
    running: false,
    phase: "idle",
    stoppedAt: Date.now(),
    error: message,
  });
  notify("Auto-prompting stopped", message, "error");
}

// ── the running Gemini tab got closed ────────────────────────
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { running, targetTabId } = await chrome.storage.local.get(["running", "targetTabId"]);
  if (running && targetTabId === tabId) {
    stopWithError("The Gemini tab was closed.");
  }
});

// ── stall watchdog ───────────────────────────────────────────
// The content script writes a heartbeat every 10s while running. If it goes
// quiet (page crashed, navigated away, logged out, tab discarded) we alert.
async function syncWatchdog() {
  const { running } = await chrome.storage.local.get("running");
  if (running) chrome.alarms.create("watchdog", { periodInMinutes: 1 });
  else chrome.alarms.clear("watchdog");
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "watchdog") return;
  const { running, heartbeat } = await chrome.storage.local.get(["running", "heartbeat"]);
  if (!running) return chrome.alarms.clear("watchdog");
  if (Date.now() - (heartbeat || 0) > STALL_LIMIT) {
    stopWithError("Gemini stopped responding to the extension (page reloaded, navigated away, or logged out?).");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.running) syncWatchdog();
});

syncWatchdog();
