// Auto-Prompter for Gemini — Copyright (c) 2026 Murtaza Khalid. All rights reserved.
// Licensed under the terms in the LICENSE file. Not affiliated with Google.

// Runs inside gemini.google.com.
// The popup only writes to chrome.storage; this script reacts to it.

(() => {
  const LOG = (...a) => console.log("[AutoPrompter]", ...a);

  // All Gemini DOM selectors in one place. If Gemini changes its layout,
  // this is what should need updating. First match wins.
  const SELECTORS = {
    input: [
      'rich-textarea .ql-editor[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    send: [
      'button[aria-label="Send message"]',
      "button.send-button:not(.stop)",
      'button[aria-label*="Send"]',
    ],
    stop: [
      'button[aria-label="Stop response"]',
      "button.send-button.stop",
      'button[aria-label*="Stop"]',
    ],
    response: "model-response",
    toast: 'snack-bar-container, mat-snack-bar-container, [role="alert"]',
  };

  // Text Gemini shows when you've sent too much in a short time.
  const RATE_LIMIT_PATTERNS = [
    /reached your (daily |usage )?limit/i,
    /too many (requests|prompts|messages)/i,
    /try again later/i,
    /usage limit/i,
    /quota/i,
    /unusual activity/i,
  ];
  const LIMIT_REPLY_MAX_CHARS = 600; // limit notices are short; long replies are real answers

  const BACKOFF_MINUTES = [5, 10, 20, 40, 60];
  const REPLY_START_TIMEOUT = 15_000;
  const REPLY_MAX_DURATION = 180_000;
  const HISTORY_SIZE = 5;

  let myTabId = null;
  let running = false;
  let looping = false;
  let deadline = 0; // end of the current wait / cooldown; popup can pull it in

  // ── helpers ────────────────────────────────────────────────
  const store = {
    get: (keys) => chrome.storage.local.get(keys),
    set: (obj) => chrome.storage.local.set(obj),
  };

  const find = (list) => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const isEnabled = (btn) =>
    btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";

  const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  class Stopped extends Error {}
  class SendBlocked extends Error {}

  // Sleeps in small slices so Stop takes effect right away.
  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!running) throw new Stopped();
      await new Promise((r) => setTimeout(r, Math.min(250, end - Date.now())));
    }
  }

  // Sleeps until `deadline`, which can move (Skip wait / Retry now).
  async function sleepUntilDeadline() {
    while (Date.now() < deadline) {
      if (!running) throw new Stopped();
      await new Promise((r) => setTimeout(r, Math.min(250, deadline - Date.now())));
    }
    if (!running) throw new Stopped();
  }

  async function waitFor(fn, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(300);
    }
    return null;
  }

  function getPrompts(s) {
    if (s.source === "file") return s.filePrompts || [];
    if (s.source === "write") return s.writePrompts || [];
    return PROMPTS;
  }

  // ── alerts ─────────────────────────────────────────────────
  async function alertUser(kind, title, message) {
    chrome.runtime.sendMessage({ type: "alert", kind, title, message });
    showCard(kind, title, message);
    const { sound } = await store.get("sound");
    if (sound !== false) beep(kind);
  }

  function beep(kind) {
    try {
      const ctx = new AudioContext();
      const notes = kind === "done" ? [660, 880] : [880, 660, 880];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        o.type = "sine";
        const t = ctx.currentTime + i * 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.17);
      });
      setTimeout(() => ctx.close(), 1000);
    } catch {
      // audio blocked until the user interacts with the page
    }
  }

  // ── Gemini interaction ─────────────────────────────────────
  const norm = (t) => t.replace(/\s+/g, " ").trim();

  async function typePrompt(input, text) {
    input.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);

    // A synthetic paste keeps line breaks intact in Gemini's editor.
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 150));
    const probe = norm(text).slice(0, 40);
    if (norm(input.textContent).includes(probe)) return;

    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    document.execCommand("insertText", false, text);
    await new Promise((r) => setTimeout(r, 150));
    if (norm(input.textContent).includes(probe)) return;

    input.innerHTML = "";
    for (const line of text.split("\n")) {
      const p = document.createElement("p");
      if (line) p.textContent = line;
      else p.appendChild(document.createElement("br"));
      input.appendChild(p);
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  async function sendPrompt(text) {
    const input = await waitFor(() => find(SELECTORS.input), 20_000);
    if (!input) throw new Error("Couldn't find Gemini's input box — the Gemini layout may have changed.");
    await typePrompt(input, text);

    const btn = await waitFor(() => {
      const b = find(SELECTORS.send);
      return isEnabled(b) ? b : null;
    }, 30_000);
    if (!btn) throw new SendBlocked("Gemini's send button stayed disabled.");
    btn.click();
  }

  async function waitForReply() {
    const started = await waitFor(() => find(SELECTORS.stop), REPLY_START_TIMEOUT);
    if (!started) {
      LOG("Reply indicator not seen; continuing.");
      await sleep(1500);
      return;
    }
    const finished = await waitFor(() => !find(SELECTORS.stop), REPLY_MAX_DURATION);
    if (!finished) LOG("Reply took too long; moving on.");
    await sleep(1500);
  }

  const countResponses = () => document.querySelectorAll(SELECTORS.response).length;

  // Returns the limit message if Gemini refused because of too many prompts.
  function detectRateLimit(responsesBefore) {
    const texts = [];
    const responses = document.querySelectorAll(SELECTORS.response);
    if (responses.length > responsesBefore) {
      const t = norm(responses[responses.length - 1].innerText || "");
      if (t.length <= LIMIT_REPLY_MAX_CHARS) texts.push(t);
    }
    for (const el of document.querySelectorAll(SELECTORS.toast)) {
      if (el.closest("#gemini-auto-prompter-pill, #gemini-auto-prompter-card")) continue;
      texts.push(norm(el.innerText || ""));
    }
    return texts.find((t) => RATE_LIMIT_PATTERNS.some((re) => re.test(t))) || null;
  }

  // ── run control ────────────────────────────────────────────
  async function finish(message) {
    running = false;
    await store.set({ running: false, stoppedAt: Date.now(), finished: message, phase: "idle" });
    alertUser("done", "Auto-prompting finished", message);
  }

  async function cooldown(s, reason) {
    const step = s.backoffStep || 0;
    const mins = BACKOFF_MINUTES[Math.min(step, BACKOFF_MINUTES.length - 1)];
    let until = Date.now() + mins * 60_000;
    if (s.loopMode === "until" && s.endAt) until = Math.min(until, s.endAt);
    deadline = until;
    await store.set({
      phase: "cooldown",
      cooldownUntil: until,
      cooldownTotal: until - Date.now(),
      backoffStep: step + 1,
      lastLimitText: reason,
    });
    LOG(`Rate limited (${reason}); cooling down ${mins} min`);
    alertUser("limit", "Gemini limit hit", `Pausing ${mins} min — will retry automatically at ${fmtClock(until)}.`);
    await sleepUntilDeadline();
    await store.set({ cooldownUntil: null });
    removeCard();
  }

  const untilReached = (s) => s.loopMode === "until" && s.endAt && Date.now() >= s.endAt;

  async function runLoop() {
    if (looping) return;
    looping = true;
    const hb = setInterval(() => running && store.set({ heartbeat: Date.now() }), 10_000);
    store.set({ heartbeat: Date.now() });
    LOG("Started");
    try {
      // Picking up after a page refresh in the middle of a wait or cooldown.
      let s = await store.get(null);
      if (s.phase === "waiting" && s.nextAt > Date.now()) {
        deadline = s.nextAt;
        await sleepUntilDeadline();
      } else if (s.phase === "cooldown" && s.cooldownUntil > Date.now()) {
        deadline = s.cooldownUntil;
        await sleepUntilDeadline();
        await store.set({ cooldownUntil: null });
      }

      while (running) {
        s = await store.get(null);
        if (untilReached(s)) {
          await finish(`Reached ${fmtClock(s.endAt)}.`);
          break;
        }

        const list = getPrompts(s);
        if (!list.length) throw new Error("No prompts in the selected source.");
        const idx = (s.index || 0) % list.length;
        const text = list[idx];

        await store.set({ phase: "sending", error: null, finished: null });
        LOG(`Sending ${idx + 1}/${list.length}:`, text);
        const before = countResponses();
        try {
          await sendPrompt(text);
        } catch (e) {
          // A disabled send button can mean Gemini is blocking us; cool down once before giving up.
          if (e instanceof SendBlocked && !(s.backoffStep > 0)) {
            await cooldown(s, e.message);
            continue;
          }
          throw e;
        }

        const history = [{ text, n: idx + 1, time: Date.now() }, ...(s.history || [])].slice(0, HISTORY_SIZE);
        await store.set({ phase: "replying", sent: (s.sent || 0) + 1, history });

        await waitForReply();

        const limit = detectRateLimit(before);
        if (limit) {
          await cooldown(await store.get(null), limit); // retry the same prompt
          continue;
        }

        // Success: move on.
        let next = idx + 1;
        let runLoops = s.runLoops || 0;
        if (next >= list.length) {
          next = 0;
          runLoops++;
        }
        await store.set({ index: next, runLoops, backoffStep: 0 });

        if (s.loopMode === "count" && runLoops >= (s.loopCount || 1)) {
          await finish(`${runLoops} pass${runLoops === 1 ? "" : "es"} through ${list.length} prompts completed.`);
          break;
        }

        s = await store.get(["minDelay", "maxDelay", "loopMode", "endAt"]);
        const min = s.minDelay ?? DEFAULT_MIN_DELAY;
        const max = Math.max(min, s.maxDelay ?? DEFAULT_MAX_DELAY);
        let nextAt = Date.now() + Math.round((min + Math.random() * (max - min)) * 1000);
        if (s.loopMode === "until" && s.endAt) nextAt = Math.min(nextAt, s.endAt);
        deadline = nextAt;
        await store.set({ phase: "waiting", nextAt, waitTotal: nextAt - Date.now() });
        LOG(`Waiting ${Math.round((nextAt - Date.now()) / 1000)}s`);
        await sleepUntilDeadline();
      }
    } catch (e) {
      if (!(e instanceof Stopped)) {
        LOG("Error:", e.message);
        running = false;
        await store.set({ running: false, stoppedAt: Date.now(), error: e.message });
        alertUser("error", "Auto-prompting stopped", e.message);
      }
    } finally {
      clearInterval(hb);
      await store.set({ phase: "idle", nextAt: null, cooldownUntil: null });
      looping = false;
      LOG("Stopped");
      if (running) runLoop(); // restarted while we were shutting down
    }
  }

  let wasRunning = false;
  async function sync() {
    const s = await store.get(["running", "targetTabId"]);
    running = !!s.running && s.targetTabId === myTabId;
    if (running && !wasRunning) removeCard();
    wasRunning = running;
    if (running) runLoop();
    renderPill();
  }

  async function resume() {
    const s = await store.get(["startedAt", "stoppedAt"]);
    await store.set({
      running: true,
      targetTabId: myTabId,
      error: null,
      finished: null,
      phase: "sending",
      heartbeat: Date.now(),
      startedAt: s.startedAt && s.stoppedAt ? Date.now() - (s.stoppedAt - s.startedAt) : Date.now(),
      stoppedAt: null,
    });
  }

  // ── on-page UI (Shadow DOM so Gemini's styles don't leak in) ─
  const BASE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Google Sans", Inter, system-ui, sans-serif; }
    b.g { font-weight:600; background:linear-gradient(90deg,#4f8cff,#a46bff,#ff6fae); -webkit-background-clip:text; background-clip:text; color:transparent; }
  `;

  // Small status pill, bottom-right.
  let pillRoot = null;
  let pillTimer = null;

  function buildPill() {
    const host = document.createElement("div");
    host.id = "gemini-auto-prompter-pill";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483646;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${BASE_CSS}
        .pill {
          display:flex; align-items:center; gap:10px;
          padding:8px 8px 8px 14px; border-radius:999px;
          font-size:13px; font-weight:500; line-height:1;
          color:#e8eaf0; background:rgba(22,24,33,.92);
          backdrop-filter:blur(10px);
          border:1px solid rgba(255,255,255,.08);
          box-shadow:0 8px 30px rgba(0,0,0,.35), 0 0 0 1px rgba(138,92,246,.15);
          animation:in .3s ease;
        }
        @keyframes in { from { opacity:0; transform:translateY(10px); } }
        .dot { width:8px; height:8px; border-radius:50%; background:#34d399; position:relative; flex-shrink:0; }
        .dot::after { content:""; position:absolute; inset:0; border-radius:50%; background:inherit; animation:pulse 1.6s infinite; }
        .dot.wait { background:#fbbf24; }
        .dot.cool { background:#fb7149; }
        @keyframes pulse { to { transform:scale(2.6); opacity:0; } }
        .label { white-space:nowrap; }
        button {
          all:unset; cursor:pointer; display:grid; place-items:center;
          width:26px; height:26px; border-radius:50%;
          background:rgba(255,255,255,.08); transition:background .2s;
        }
        button:hover { background:#ef4444; }
        button span { width:9px; height:9px; border-radius:2px; background:#fff; }
      </style>
      <div class="pill">
        <div class="dot"></div>
        <div class="label"></div>
        <button title="Stop auto-prompting"><span></span></button>
      </div>`;
    root.querySelector("button").addEventListener("click", () =>
      store.set({ running: false, stoppedAt: Date.now() })
    );
    document.documentElement.appendChild(host);
    return root;
  }

  const mmss = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
  };

  async function renderPill() {
    if (!running) {
      clearInterval(pillTimer);
      pillTimer = null;
      document.getElementById("gemini-auto-prompter-pill")?.remove();
      pillRoot = null;
      return;
    }
    if (!pillRoot) pillRoot = buildPill();
    if (!pillTimer) pillTimer = setInterval(renderPill, 500);

    const s = await store.get(null);
    const list = getPrompts(s);
    const total = list.length || 1;
    const label = pillRoot.querySelector(".label");
    const dot = pillRoot.querySelector(".dot");
    dot.className = "dot" + (s.phase === "waiting" ? " wait" : s.phase === "cooldown" ? " cool" : "");
    const pass =
      s.loopMode === "count" ? ` · pass ${Math.min((s.runLoops || 0) + 1, s.loopCount || 1)}/${s.loopCount || 1}` : "";
    let what;
    if (s.phase === "cooldown" && s.cooldownUntil) what = `limit hit · retry in ${mmss(s.cooldownUntil - Date.now())}`;
    else if (s.phase === "waiting" && s.nextAt) what = `next in ${mmss(s.nextAt - Date.now())}`;
    else if (s.phase === "replying") what = "Gemini is replying…";
    else what = `sending ${((s.index || 0) % total) + 1}/${total}`;
    label.innerHTML = `<b class="g">Auto-prompting</b> · ${what}${pass}`;
  }

  // Alert card, top-center. Stays until dismissed.
  function removeCard() {
    document.getElementById("gemini-auto-prompter-card")?.remove();
  }

  function showCard(kind, title, message) {
    removeCard();
    const host = document.createElement("div");
    host.id = "gemini-auto-prompter-card";
    host.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    const color = { error: "#ef4444", limit: "#fb7149", done: "#34d399" }[kind];
    const icon = { error: "!", limit: "⏸", done: "✓" }[kind];
    root.innerHTML = `
      <style>${BASE_CSS}
        .card {
          width:min(440px, calc(100vw - 32px)); display:flex; gap:14px; align-items:flex-start;
          padding:16px 16px 14px; border-radius:16px;
          color:#e8eaf0; background:rgba(22,24,33,.96); backdrop-filter:blur(12px);
          border:1px solid ${color}55; box-shadow:0 16px 50px rgba(0,0,0,.45), 0 0 0 4px ${color}1f;
          animation:drop .35s cubic-bezier(.2,.9,.3,1.2);
        }
        @keyframes drop { from { opacity:0; transform:translateY(-16px) scale(.97); } }
        .icon { flex-shrink:0; width:34px; height:34px; border-radius:10px; display:grid; place-items:center;
          font-size:17px; font-weight:700; color:#fff; background:${color}; }
        .body { flex:1; min-width:0; }
        .title { font-size:15px; font-weight:600; margin-bottom:3px; }
        .msg { font-size:13px; line-height:1.45; color:#c4c8d4; }
        .time { font-size:11px; color:#8b91a3; margin-top:4px; }
        .actions { display:flex; gap:8px; margin-top:12px; }
        button { all:unset; cursor:pointer; padding:7px 14px; border-radius:9px; font-size:13px; font-weight:600; transition:filter .2s, background .2s; }
        .primary { color:#fff; background:linear-gradient(135deg,#4f8cff,#a46bff 55%,#ff6fae); }
        .primary:hover { filter:brightness(1.1); }
        .ghost { color:#c4c8d4; background:rgba(255,255,255,.07); }
        .ghost:hover { background:rgba(255,255,255,.13); }
      </style>
      <div class="card" role="alert">
        <div class="icon">${icon}</div>
        <div class="body">
          <div class="title"></div>
          <div class="msg"></div>
          <div class="time"></div>
          <div class="actions">
            ${kind === "error" ? '<button class="primary" data-a="resume">Resume</button>' : ""}
            ${kind === "limit" ? '<button class="primary" data-a="retry">Retry now</button>' : ""}
            <button class="ghost" data-a="dismiss">Dismiss</button>
          </div>
        </div>
      </div>`;
    root.querySelector(".title").textContent = title;
    root.querySelector(".msg").textContent = message;
    root.querySelector(".time").textContent = fmtClock(Date.now());
    root.querySelector(".actions").addEventListener("click", (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === "resume") resume();
      else if (a === "retry") store.set({ cooldownUntil: Date.now() });
      if (a) removeCard();
    });
    document.documentElement.appendChild(host);
  }

  // ── wiring ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "ping") sendResponse({ ok: true, tabId: myTabId });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    // Popup "Skip wait" / "Retry now" pull the deadline in.
    if (changes.nextAt && changes.nextAt.newValue && changes.nextAt.newValue < deadline) deadline = changes.nextAt.newValue;
    if (changes.cooldownUntil && changes.cooldownUntil.newValue && changes.cooldownUntil.newValue < deadline)
      deadline = changes.cooldownUntil.newValue;
    if (changes.running || changes.targetTabId) sync();
  });

  chrome.runtime.sendMessage({ type: "whoami" }, (res) => {
    myTabId = res && res.tabId;
    sync();
  });
})();
