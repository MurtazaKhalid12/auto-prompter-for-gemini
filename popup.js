// Auto-Prompter for Gemini — Copyright (c) 2026 Murtaza Khalid. All rights reserved.
// Licensed under the terms in the LICENSE file. Not affiliated with Google.

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
const GEMINI_URL = "https://gemini.google.com/app";
const RING_LEN = 2 * Math.PI * 54;
const MIN_DELAY = 5;
const MAX_DELAY = 3600;

const DEFAULTS = {
  source: "builtin",
  loopMode: "infinite",
  loopCount: 3,
  untilTime: "18:00",
  delayMode: "fixed",
  minDelay: DEFAULT_MIN_DELAY,
  maxDelay: DEFAULT_MAX_DELAY,
  notify: true,
  sound: true,
};
const FIXED_PRESETS = [15, 30, 60, 120, 300];
const RANDOM_PRESETS = [[10, 20], [30, 60], [60, 120], [120, 300]];

let state = {};
let activeTab = null;
let tabReady = false;

const save = (obj) => {
  Object.assign(state, obj);
  return chrome.storage.local.set(obj);
};

// ── formatting ───────────────────────────────────────────────
const isGemini = (tab) => !!tab && typeof tab.url === "string" && tab.url.startsWith("https://gemini.google.com/");

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function fmtLeft(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const fmtSecs = (s) => (s >= 60 && s % 60 === 0 ? `${s / 60}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function computeEndAt(hhmm) {
  const [h, m] = (hhmm || "18:00").split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function activePrompts() {
  if (state.source === "file") return state.filePrompts || [];
  if (state.source === "write") return state.writePrompts || [];
  return PROMPTS;
}

// ── banner ───────────────────────────────────────────────────
function showBanner(kind, text, btn = null, btn2 = null) {
  $("banner").className = "banner " + kind;
  $("bannerText").textContent = text;
  $("bannerBtn").textContent = btn ? btn[0] : "";
  $("bannerBtn").onclick = btn ? btn[1] : null;
  $("bannerBtn2").textContent = btn2 ? btn2[0] : "";
  $("bannerBtn2").onclick = btn2 ? btn2[1] : null;
}
const hideBanner = () => $("banner").classList.add("hidden");

// ── settings UI (only re-rendered when settings change) ──────
function setSeg(key, value) {
  const seg = document.querySelector(`.seg[data-key="${key}"]`);
  seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === value));
  $$(`[data-panel^="${key}:"]`).forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== `${key}:${value}`));
}

function setDelayRow(row, secs) {
  const num = row.querySelector(".num");
  const unit = row.querySelector(".unit");
  if (document.activeElement === num || document.activeElement === unit) return;
  const inMin = secs >= 60 && secs % 60 === 0;
  unit.value = inMin ? "60" : "1";
  num.value = inMin ? secs / 60 : secs;
}

function renderChips() {
  const min = state.minDelay;
  const max = state.maxDelay;
  const fixed = document.querySelector('[data-presets="fixed"]');
  fixed.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", min === max && +c.dataset.a === min));
  const random = document.querySelector('[data-presets="random"]');
  random.querySelectorAll(".chip").forEach((c) =>
    c.classList.toggle("active", +c.dataset.a === min && +c.dataset.b === max)
  );
}

function renderConfig() {
  const s = state;
  const running = !!s.running;

  setSeg("source", s.source);
  setSeg("loopMode", s.loopMode);
  setSeg("delayMode", s.delayMode);
  $("sourceCard").classList.toggle("locked", running);
  $("loopCard").classList.toggle("locked", running);

  // sources
  $("builtinCount").textContent = PROMPTS.length;
  const files = s.filePrompts || [];
  const hasFile = !!s.fileName;
  $("drop").classList.toggle("hidden", hasFile);
  $("fileInfo").classList.toggle("hidden", !hasFile);
  $("fileName").textContent = s.fileName || "";
  $("fileCount").textContent = `${files.length} prompt${files.length === 1 ? "" : "s"} found`;
  if (document.activeElement !== $("writeText")) $("writeText").value = s.writeText || "";
  $("writeCount").textContent = (s.writePrompts || []).length;

  // loop
  if (document.activeElement !== $("loopCount")) $("loopCount").value = s.loopCount;
  if (document.activeElement !== $("untilTime")) $("untilTime").value = s.untilTime;

  // delay
  $$('[data-panel="delayMode:fixed"] .delay-row').forEach((r) => setDelayRow(r, s.minDelay));
  $$('[data-panel="delayMode:random"] .delay-row').forEach((r) =>
    setDelayRow(r, r.dataset.which === "max" ? s.maxDelay : s.minDelay)
  );
  renderChips();

  // alerts
  $("optNotify").checked = s.notify !== false;
  $("optSound").checked = s.sound !== false;
}

// ── live UI (re-rendered 4x a second) ────────────────────────
function render() {
  const s = state;
  const list = activePrompts();
  const total = list.length;
  const running = !!s.running;
  const idx = total ? (s.index || 0) % total : 0;
  const waiting = running && s.phase === "waiting" && s.nextAt;
  const cooling = running && s.phase === "cooldown" && s.cooldownUntil;

  // status pill
  const kind = !running ? "idle" : cooling ? "cooldown" : waiting ? "waiting" : "running";
  $("status").className = "status " + kind;
  $("status").querySelector("span").textContent =
    { idle: "Idle", running: "Running", waiting: "Waiting", cooldown: "Cooling down" }[kind];

  // big button
  const toggle = $("toggle");
  toggle.classList.toggle("on", running);
  toggle.disabled = !running && total === 0;
  toggle.setAttribute("aria-label", running ? "Stop" : "Start");
  $("iconPlay").classList.toggle("hidden", running);
  $("iconStop").classList.toggle("hidden", !running);

  // ring + phase text + skip link
  let progress = 0;
  const phase = $("phase");
  const skip = $("skip");
  skip.classList.add("hidden");
  $("ringWrap").classList.toggle("cool", !!cooling);
  if (!running) {
    phase.textContent = s.finished ? "Run finished" : s.sent ? "Stopped — press play for a new run" : "Ready when you are";
  } else if (cooling) {
    const left = Math.max(0, s.cooldownUntil - Date.now());
    progress = s.cooldownTotal ? 1 - left / s.cooldownTotal : 0;
    phase.textContent = `Gemini limit hit — retrying in ${fmtDuration(left)}`;
    skip.textContent = "Retry now";
    skip.classList.remove("hidden");
  } else if (waiting) {
    const left = Math.max(0, s.nextAt - Date.now());
    progress = s.waitTotal ? 1 - left / s.waitTotal : 0;
    phase.textContent = `Next prompt in ${left >= 60000 ? fmtDuration(left) : Math.ceil(left / 1000) + "s"}`;
    skip.textContent = "Skip wait";
    skip.classList.remove("hidden");
  } else if (s.phase === "replying") {
    phase.innerHTML = 'Gemini is replying <span class="dots"><i></i><i></i><i></i></span>';
  } else {
    phase.innerHTML = 'Sending prompt <span class="dots"><i></i><i></i><i></i></span>';
  }
  $("ringBar").style.strokeDashoffset = RING_LEN * (1 - Math.min(1, Math.max(0, progress)));

  // current prompt card
  $("promptLabel").textContent = running && s.phase === "sending" ? "Sending now" : "Up next";
  $("position").textContent = total ? `${idx + 1} of ${total}` : "0 of 0";
  $("progressBar").style.width = total ? `${((idx + 1) / total) * 100}%` : "0";
  $("preview").textContent = total ? list[idx] : "No prompts in this source yet.";

  const pass = (s.runLoops || 0) + 1;
  let info = "";
  if (s.loopMode === "count") {
    info = running ? `Pass ${Math.min(pass, s.loopCount)} of ${s.loopCount}` : `Will run ${s.loopCount} pass${s.loopCount === 1 ? "" : "es"}`;
  } else if (s.loopMode === "until") {
    const endAt = running && s.endAt ? s.endAt : computeEndAt(s.untilTime);
    info = `Until ${fmtClock(endAt)} · ${fmtLeft(endAt - Date.now())} left`;
  } else {
    info = running ? `Pass ${pass} · ∞ infinite` : "Loops forever until stopped";
  }
  $("runInfo").textContent = info;

  // until hint
  if (s.loopMode === "until") {
    const endAt = running && s.endAt ? s.endAt : computeEndAt(s.untilTime);
    const tomorrow = new Date(endAt).getDate() !== new Date().getDate();
    $("untilHint").textContent = `Stops at ${fmtClock(endAt)}${tomorrow ? " tomorrow" : ""} (in ${fmtLeft(endAt - Date.now())})`;
  }

  // stats
  $("statSent").textContent = s.sent || 0;
  $("statPasses").textContent = s.runLoops || 0;
  const end = running ? Date.now() : s.stoppedAt || s.startedAt;
  $("statTime").textContent = s.startedAt ? fmtDuration(end - s.startedAt) : "0:00";

  // history
  const ul = $("history");
  const hist = s.history || [];
  const key = hist.map((h) => h.time).join(",");
  if (ul.dataset.key !== key) {
    ul.dataset.key = key;
    ul.innerHTML = hist.length ? "" : '<li class="empty">Nothing sent yet</li>';
    for (const h of hist) {
      const li = document.createElement("li");
      li.innerHTML = '<span class="num"></span><span class="txt"></span><span class="time"></span>';
      li.querySelector(".num").textContent = h.n;
      li.querySelector(".txt").textContent = h.text;
      li.querySelector(".txt").title = h.text;
      li.querySelector(".time").textContent = fmtClock(h.time);
      ul.appendChild(li);
    }
  }

  // banners: errors, then finished, then tab / source problems
  if (s.error && !running) {
    showBanner("error", s.error, ["Resume", resume], ["Dismiss", () => save({ error: null }).then(render)]);
  } else if (s.finished && !running) {
    showBanner("success", "Done — " + s.finished, ["Dismiss", () => save({ finished: null }).then(render)]);
  } else if (!running && !isGemini(activeTab)) {
    showBanner("", "Open Gemini in this tab to start.", ["Open Gemini", () => chrome.tabs.create({ url: GEMINI_URL })]);
  } else if (!running && !tabReady) {
    showBanner("", "Reload the Gemini tab so the extension can connect.", [
      "Reload",
      () => {
        chrome.tabs.reload(activeTab.id);
        window.close();
      },
    ]);
  } else if (!running && total === 0) {
    showBanner("", s.source === "file" ? "Choose a .txt file with prompts first." : "Write at least one prompt first.");
  } else {
    hideBanner();
  }
}

// ── actions ──────────────────────────────────────────────────
const canRunHere = () => isGemini(activeTab) && tabReady;

async function toggle() {
  if (state.running) {
    await save({ running: false, stoppedAt: Date.now() });
    return render();
  }
  if (!canRunHere() || !activePrompts().length) return render();
  await save({
    // snapshot the settings so the page script sees exactly what the popup shows
    source: state.source,
    loopMode: state.loopMode,
    loopCount: state.loopCount,
    untilTime: state.untilTime,
    minDelay: state.minDelay,
    maxDelay: state.maxDelay,
    running: true,
    targetTabId: activeTab.id,
    phase: "sending",
    error: null,
    finished: null,
    index: 0,
    runLoops: 0,
    sent: 0,
    backoffStep: 0,
    nextAt: null,
    cooldownUntil: null,
    endAt: state.loopMode === "until" ? computeEndAt(state.untilTime) : null,
    startedAt: Date.now(),
    stoppedAt: null,
    heartbeat: Date.now(),
  });
  renderConfig();
  render();
}

// Continue the stopped run where it left off (after an error).
async function resume() {
  if (!canRunHere()) {
    await save({ error: null });
    return render();
  }
  await save({
    running: true,
    targetTabId: activeTab.id,
    phase: "sending",
    error: null,
    finished: null,
    heartbeat: Date.now(),
    startedAt: state.startedAt && state.stoppedAt ? Date.now() - (state.stoppedAt - state.startedAt) : Date.now(),
    stoppedAt: null,
  });
  renderConfig();
  render();
}

function skip() {
  if (state.phase === "cooldown") save({ cooldownUntil: Date.now() });
  else if (state.phase === "waiting") save({ nextAt: Date.now() });
}

function saveDelay(min, max) {
  min = Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(min)));
  max = Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(max)));
  save({ minDelay: min, maxDelay: max });
  renderChips();
}

function onDelayInput(row) {
  const secs = (+row.querySelector(".num").value || 0) * +row.querySelector(".unit").value;
  if (!secs) return;
  if (state.delayMode === "fixed") return saveDelay(secs, secs);
  let { minDelay: min, maxDelay: max } = state;
  if (row.dataset.which === "max") max = secs;
  else min = secs;
  // keep min ≤ max by moving the other end
  if (min > max) row.dataset.which === "max" ? (min = max) : (max = min);
  saveDelay(min, max);
}

function loadFile(file) {
  $("fileError").classList.add("hidden");
  if (!file) return;
  if (!/\.txt$/i.test(file.name) && file.type !== "text/plain") {
    $("fileError").textContent = "Please choose a .txt file.";
    $("fileError").classList.remove("hidden");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const prompts = parsePrompts(reader.result);
    if (!prompts.length) {
      $("fileError").textContent = `No prompts found in ${file.name}.`;
      $("fileError").classList.remove("hidden");
      return;
    }
    save({ filePrompts: prompts, fileName: file.name }).then(() => {
      renderConfig();
      render();
    });
  };
  reader.readAsText(file);
}

// ── init ─────────────────────────────────────────────────────
function wire() {
  $("toggle").addEventListener("click", toggle);
  $("skip").addEventListener("click", skip);
  $("reset").addEventListener("click", () => save({ history: [] }).then(render));

  // segmented controls
  $$(".seg").forEach((seg) =>
    seg.addEventListener("click", (e) => {
      const v = e.target.closest("button")?.dataset.v;
      if (!v) return;
      const key = seg.dataset.key;
      if (key === "delayMode") {
        // switching to random from a fixed value: open up a sensible range
        if (v === "random" && state.minDelay === state.maxDelay) saveDelay(state.minDelay, state.minDelay * 2);
        if (v === "fixed") saveDelay(state.minDelay, state.minDelay);
      }
      save({ [key]: v });
      renderConfig();
      render();
    })
  );

  // file source
  $("fileInput").addEventListener("change", (e) => loadFile(e.target.files[0]));
  $("fileReplace").addEventListener("click", () => $("fileInput").click());
  $("fileRemove").addEventListener("click", () =>
    save({ filePrompts: [], fileName: null }).then(() => {
      renderConfig();
      render();
    })
  );
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });

  // write source
  let writeTimer = null;
  $("writeText").addEventListener("input", () => {
    const text = $("writeText").value;
    const prompts = parsePrompts(text);
    $("writeCount").textContent = prompts.length;
    state.writePrompts = prompts;
    render();
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => save({ writeText: text, writePrompts: prompts }), 400);
  });

  // loop
  const setCount = (n) => {
    n = Math.min(999, Math.max(1, Math.round(+n || 1)));
    $("loopCount").value = n;
    save({ loopCount: n });
    render();
  };
  $("countMinus").addEventListener("click", () => setCount(state.loopCount - 1));
  $("countPlus").addEventListener("click", () => setCount(state.loopCount + 1));
  $("loopCount").addEventListener("change", () => setCount($("loopCount").value));
  $("untilTime").addEventListener("change", () => {
    if ($("untilTime").value) save({ untilTime: $("untilTime").value });
    render();
  });

  // delay
  $$(".delay-row").forEach((row) => {
    row.querySelector(".num").addEventListener("input", () => onDelayInput(row));
    row.querySelector(".unit").addEventListener("change", () => onDelayInput(row));
  });
  const fixedChips = document.querySelector('[data-presets="fixed"]');
  for (const p of FIXED_PRESETS) {
    const c = document.createElement("button");
    c.className = "chip";
    c.dataset.a = p;
    c.textContent = fmtSecs(p);
    c.onclick = () => {
      saveDelay(p, p);
      renderConfig();
    };
    fixedChips.appendChild(c);
  }
  const randomChips = document.querySelector('[data-presets="random"]');
  for (const [a, b] of RANDOM_PRESETS) {
    const c = document.createElement("button");
    c.className = "chip";
    c.dataset.a = a;
    c.dataset.b = b;
    c.textContent = `${fmtSecs(a)}–${fmtSecs(b)}`;
    c.onclick = () => {
      saveDelay(a, b);
      renderConfig();
    };
    randomChips.appendChild(c);
  }

  // alerts
  $("optNotify").addEventListener("change", () => save({ notify: $("optNotify").checked }));
  $("optSound").addEventListener("change", () => save({ sound: $("optSound").checked }));
}

async function init() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isGemini(activeTab)) {
    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, { type: "ping" });
      tabReady = !!(res && res.ok);
    } catch {
      tabReady = false;
    }
  }

  const stored = await chrome.storage.local.get(null);
  state = { ...DEFAULTS, ...stored };
  if (!stored.delayMode) state.delayMode = state.minDelay === state.maxDelay ? "fixed" : "random";
  wire();
  renderConfig();
  render();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [k, v] of Object.entries(changes)) state[k] = v.newValue ?? DEFAULTS[k];
    renderConfig();
    render();
  });
  setInterval(render, 250);
}

init();
