/* Bite · app.js — UI, flows, rendering */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("en-US");
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

const RING_C = 2 * Math.PI * 94; // 590.6

/* ═══════════════════ boot ═══════════════════ */

let currentDateKey = "";

window.addEventListener("DOMContentLoaded", () => {
  Store.load();
  registerSW();
  buildHeightSelects();
  wireOnboarding();
  wireApp();
  wireSheets();
  wirePhotoFlow();
  wireScan();
  wireManual();
  wireEntrySheet();
  wireSettings();

  if (Store.profile) enterApp(false);
  else showOnboarding();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Store.profile && currentDateKey && currentDateKey !== Store.todayKey()) {
      renderToday(false); renderHistory();
    }
  });
});

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const IS_STANDALONE = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

/* ═══════════════════ onboarding ═══════════════════ */

const OB = { step: 0, name: "", sex: "", age: null, units: "us", ft: 5, in: 8, cm: null, weight: null, activity: 1.375, goal: null, p: null, c: null, f: null, bonus: 300 };
const OB_STEPS = 6;

function showOnboarding() {
  $("#onboarding").classList.remove("hidden");
  if (IS_IOS && !IS_STANDALONE) $("#install-hint").classList.remove("hidden");
  renderObDots();
}

function renderObDots() {
  $("#ob-dots").innerHTML = Array.from({ length: OB_STEPS }, (_, i) =>
    `<span class="${i === OB.step ? "on" : ""}"></span>`).join("");
  $("#ob-back").classList.toggle("hidden", OB.step === 0);
}

function goStep(n) {
  OB.step = clamp(n, 0, OB_STEPS - 1);
  $("#onboarding").scrollLeft = 0; // focus events can side-scroll the track container
  $("#ob-track").style.transform = `translateX(-${OB.step * 100}%)`;
  renderObDots();
  updateMaintenance();
}

function buildHeightSelects() {
  const ft = $("#ob-ft"), inch = $("#ob-in");
  for (let f = 3; f <= 7; f++) ft.add(new Option(`${f} ft`, f));
  for (let i = 0; i <= 11; i++) inch.add(new Option(`${i} in`, i));
  ft.value = 5; inch.value = 8;
}

function segWire(el, onPick) {
  $$("button", el).forEach(b => b.addEventListener("click", () => {
    $$("button", el).forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    buzz(8);
    onPick(b.dataset.val);
  }));
}

function segSet(el, val) {
  $$("button", el).forEach(b => b.classList.toggle("on", b.dataset.val === String(val)));
}

function obHeightCm() {
  return OB.units === "us" ? (OB.ft * 12 + OB.in) * 2.54 : (OB.cm || 0);
}
function obWeightKg() {
  return OB.units === "us" ? (OB.weight || 0) * 0.45359 : (OB.weight || 0);
}

function updateMaintenance() {
  const m = Store.maintenance(OB.sex, OB.age, obHeightCm(), obWeightKg(), OB.activity);
  $("#ob-maint").textContent = m ? fmt(m) : "—";
  return m;
}

function validateStep() {
  const btn = OB.step === 5 ? $("#ob-finish") : $(`.ob-step[data-step="${OB.step}"] [data-next]`);
  let ok = true;
  if (OB.step === 1) ok = OB.name.trim().length > 0 && OB.sex && OB.age >= 13 && OB.age <= 110;
  if (OB.step === 2) ok = obWeightKg() > 20 && obHeightCm() > 80;
  if (OB.step === 3) ok = OB.goal >= 800 && OB.goal <= 8000;
  if (OB.step === 5) ok = ($("#ob-key").value.trim().startsWith("sk-"));
  if (btn) btn.disabled = !ok;
}

function wireOnboarding() {
  $("#onboarding").addEventListener("focusin", () => { $("#onboarding").scrollLeft = 0; });
  $("#ob-back").addEventListener("click", () => goStep(OB.step - 1));
  $$("[data-next]").forEach(b => b.addEventListener("click", () => { goStep(OB.step + 1); validateStep(); }));

  $("#ob-name").addEventListener("input", e => { OB.name = e.target.value; validateStep(); });
  segWire($("#ob-sex"), v => { OB.sex = v; validateStep(); });
  $("#ob-age").addEventListener("input", e => { OB.age = +e.target.value || null; validateStep(); });

  segWire($("#ob-units"), v => {
    OB.units = v;
    $("#height-us").classList.toggle("hidden", v !== "us");
    $("#height-metric").classList.toggle("hidden", v === "us");
    $("#ob-weight-unit").textContent = v === "us" ? "(lb)" : "(kg)";
    $("#ob-weight").placeholder = v === "us" ? "160" : "72";
    validateStep();
  });
  segSet($("#ob-units"), "us");
  $("#ob-ft").addEventListener("change", e => { OB.ft = +e.target.value; validateStep(); });
  $("#ob-in").addEventListener("change", e => { OB.in = +e.target.value; validateStep(); });
  $("#ob-cm").addEventListener("input", e => { OB.cm = +e.target.value || null; validateStep(); });
  $("#ob-weight").addEventListener("input", e => { OB.weight = +e.target.value || null; validateStep(); });

  segWire($("#ob-activity"), v => { OB.activity = +v; updateMaintenance(); });
  segSet($("#ob-activity"), "1.375");

  $$("#ob-goal-chips button").forEach(b => b.addEventListener("click", () => {
    $$("#ob-goal-chips button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    const m = updateMaintenance();
    if (m) {
      OB.goal = Math.round((m + (+b.dataset.delta)) / 10) * 10;
      $("#ob-goal").value = OB.goal;
    }
    validateStep();
  }));
  $("#ob-goal").addEventListener("input", e => { OB.goal = +e.target.value || null; validateStep(); });

  $("#ob-macro-toggle").addEventListener("click", () => {
    const open = $("#ob-macro-toggle").getAttribute("aria-expanded") === "true";
    $("#ob-macro-toggle").setAttribute("aria-expanded", String(!open));
    $("#ob-macro-fields").classList.toggle("hidden", open);
  });
  $("#ob-macro-suggest").addEventListener("click", () => {
    const kg = obWeightKg(), goal = OB.goal || updateMaintenance() || 2000;
    const p = Math.round(kg * 1.6), f = Math.round(goal * 0.30 / 9);
    const c = Math.max(0, Math.round((goal - p * 4 - f * 9) / 4));
    $("#ob-p").value = OB.p = p; $("#ob-c").value = OB.c = c; $("#ob-f").value = OB.f = f;
  });
  ["p", "c", "f"].forEach(k => $(`#ob-${k}`).addEventListener("input", e => { OB[k] = +e.target.value || null; }));
  $("#ob-bonus").addEventListener("input", e => { OB.bonus = +e.target.value || 0; });

  $("#ob-key").addEventListener("input", validateStep);
  $("#ob-key").addEventListener("change", validateStep);
  $("#ob-key-eye").addEventListener("click", () => {
    const i = $("#ob-key");
    i.type = i.type === "password" ? "text" : "password";
  });

  $("#ob-finish").addEventListener("click", async () => {
    const btn = $("#ob-finish"), key = $("#ob-key").value.trim();
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      await AI.testKey(key);
      Store.key = key;
      Store.profile = {
        name: OB.name.trim(), sex: OB.sex, age: OB.age,
        heightCm: Math.round(obHeightCm()), weightKg: Math.round(obWeightKg() * 10) / 10,
        units: OB.units, activity: OB.activity,
        goalKcal: OB.goal, macroP: OB.p, macroC: OB.c, macroF: OB.f,
        bonus: OB.bonus, model: "best",
      };
      Store.saveProfile();
      successPop();
      setTimeout(() => enterApp(true), 950);
    } catch (e) {
      toast(e.message || "Couldn't verify the key.", "err");
      btn.disabled = false; btn.textContent = "Verify & finish";
    }
  });

  ["ob-name", "ob-age", "ob-weight", "ob-cm", "ob-goal"].forEach(id =>
    $("#" + id).addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); }));
}

function enterApp(fresh) {
  $("#onboarding").classList.add("hidden");
  $("#app").classList.remove("hidden");
  if (IS_IOS && !IS_STANDALONE && !Store.flags.bannerDismissed) $("#install-banner").classList.remove("hidden");
  renderToday(true);
  renderHistory();
  if (fresh) toast(`Welcome, ${Store.profile.name} 👋`, "ok");
}

/* ═══════════════════ app shell ═══════════════════ */

function wireApp() {
  $$(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));
  $("#btn-add").addEventListener("click", () => { buzz(10); openSheet($("#sheet-add")); });
  $("#btn-settings").addEventListener("click", openSettings);
  $("#install-banner-x").addEventListener("click", () => {
    Store.flags.bannerDismissed = true; Store.saveFlags();
    $("#install-banner").classList.add("hidden");
  });
  $("#ex-toggle").addEventListener("click", () => {
    const k = Store.todayKey(), d = Store.day(k);
    d.ex = !d.ex;
    Store.saveDays();
    buzz(12);
    $("#ex-toggle").setAttribute("aria-pressed", String(d.ex));
    renderToday(false);
  });
}

function switchView(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
  const showToday = name === "today";
  const view = showToday ? $("#view-today") : $("#view-history");
  $("#view-today").classList.toggle("hidden", !showToday);
  $("#view-history").classList.toggle("hidden", showToday);
  view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter");
  $("#header-title").textContent = showToday ? "Today" : "History";
  $("#header-date").textContent = showToday ? headerDate() : "Your week at a glance";
  if (!showToday) renderHistory();
}

function headerDate() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/* ═══════════════════ today ═══════════════════ */

function renderToday(animate) {
  currentDateKey = Store.todayKey();
  const p = Store.profile;
  const t = Store.totals(currentDateKey);
  const day = Store.day(currentDateKey);
  const goal = Store.goalFor(currentDateKey);
  const left = goal - t.kcal;

  $("#header-date").textContent = headerDate();
  $("#ex-bonus-label").textContent = `+${fmt(p.bonus || 0)}`;
  $("#ex-toggle").setAttribute("aria-pressed", String(day.ex));

  // ring
  const frac = clamp(t.kcal / goal, 0, 1);
  const overFrac = clamp((t.kcal - goal) / goal, 0, 1);
  $("#ring-fill").style.strokeDashoffset = RING_C * (1 - frac);
  $("#ring-over").style.strokeDashoffset = RING_C * (1 - overFrac);
  const big = $("#ring-num");
  const target = Math.abs(Math.round(left));
  big.classList.toggle("over", left < 0);
  $("#ring-label").textContent = left >= 0 ? "kcal left" : "kcal over";
  animateNum(big, target, animate ? 800 : 500);
  $("#ring-eaten").textContent = fmt(t.kcal);
  $("#ring-goal").textContent = fmt(goal);

  // macros
  const showMacros = p.macroP || p.macroC || p.macroF;
  $("#macros-card").classList.toggle("hidden", !showMacros);
  if (showMacros) {
    setMacro("p", t.p, p.macroP);
    setMacro("c", t.c, p.macroC);
    setMacro("f", t.f, p.macroF);
  }

  // meals
  const list = $("#meal-list");
  const entries = [...day.entries].sort((a, b) => b.t - a.t);
  $("#meals-empty").classList.toggle("hidden", entries.length > 0);
  $("#meals-count").textContent = entries.length ? `${entries.length} logged` : "";
  list.innerHTML = entries.map((e, i) => mealRowHTML(e, i)).join("");
  $$(".meal-row", list).forEach(r => r.addEventListener("click", () => openEntry(r.dataset.id)));
}

function setMacro(k, val, goal) {
  const row = $(`.macro-row[data-m="${k}"]`);
  row.classList.toggle("hidden", !goal);
  if (!goal) return;
  $(`#bar-${k}`).style.width = clamp(val / goal * 100, 0, 100) + "%";
  $(`#val-${k}`).textContent = `${Math.round(val)} / ${goal} g`;
}

const SRC_ICONS = {
  scan: '<svg viewBox="0 0 24 24"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 12h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  manual: '<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};

function mealRowHTML(e, i) {
  const time = new Date(e.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const macro = [e.p ? `P ${Math.round(e.p)}` : "", e.c ? `C ${Math.round(e.c)}` : "", e.f ? `F ${Math.round(e.f)}` : ""].filter(Boolean).join(" · ");
  const thumb = e.thumb
    ? `<span class="meal-thumb" style="background-image:url('${e.thumb}')"></span>`
    : `<span class="meal-thumb">${SRC_ICONS[e.src] || SRC_ICONS.manual}</span>`;
  return `<button class="meal-row" data-id="${e.id}" style="animation-delay:${Math.min(i * 45, 300)}ms">
    ${thumb}
    <span class="meal-info"><span class="meal-name">${esc(e.name)}</span><span class="meal-meta">${time}${macro ? " · " + macro : ""}</span></span>
    <span class="meal-kcal"><strong>${fmt(e.kcal)}</strong><span>kcal</span></span>
  </button>`;
}

function animateNum(el, to, dur = 700) {
  const from = +(el.dataset.v || 0);
  if (from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const tick = now => {
    const k = clamp((now - t0) / dur, 0, 1);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(tick);
    else el.dataset.v = to;
  };
  requestAnimationFrame(tick);
}

function celebrateLog(kcal) {
  successPop();
  buzz([14, 60, 14]);
  const wrap = $(".ring-wrap");
  wrap.classList.remove("pulse"); void wrap.offsetWidth; wrap.classList.add("pulse");
  setTimeout(() => toast(`Logged ${fmt(kcal)} kcal`, "ok"), 500);
}

function successPop() {
  const el = document.createElement("div");
  el.className = "check-pop";
  el.innerHTML = `<svg viewBox="0 0 110 110">
    <defs><linearGradient id="cpGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFA51F"/><stop offset="100%" stop-color="#FF3B5C"/>
    </linearGradient></defs>
    <circle class="cp-circle" cx="55" cy="55" r="48"/>
    <path class="cp-tick" d="M35 56l13 13 27-27"/>
  </svg>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/* ═══════════════════ sheets ═══════════════════ */

let openedSheet = null;

function wireSheets() {
  $("#backdrop").addEventListener("click", closeSheet);
  $$(".sheet .grabber").forEach(g => g.addEventListener("click", closeSheet));
}

function openSheet(el) {
  if (openedSheet && openedSheet !== el) {
    const prev = openedSheet;
    prev.classList.remove("show");
    setTimeout(() => { if (prev !== openedSheet) prev.classList.add("hidden"); }, 80);
  }
  openedSheet = el;
  $("#backdrop").classList.remove("hidden");
  requestAnimationFrame(() => $("#backdrop").classList.add("show"));
  el.classList.remove("hidden");
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
}

function closeSheet() {
  if (!openedSheet) return;
  const el = openedSheet;
  openedSheet = null;
  el.classList.remove("show");
  $("#backdrop").classList.remove("show");
  setTimeout(() => {
    el.classList.add("hidden");
    if (!openedSheet) $("#backdrop").classList.add("hidden");
  }, 420);
}

function showConfirm(title, body, yesLabel = "Delete") {
  return new Promise(res => {
    $("#confirm-title").textContent = title;
    $("#confirm-body").textContent = body;
    $("#confirm-yes").textContent = yesLabel;
    openSheet($("#sheet-confirm"));
    const yes = $("#confirm-yes"), no = $("#confirm-no");
    const done = v => { yes.onclick = no.onclick = null; closeSheet(); res(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
  });
}

/* ═══════════════════ photo flow ═══════════════════ */

const PHOTO = { canvas: null, result: null, items: [] };
const ANALYZE_LINES = [
  "Looking at your plate…",
  "Sizing up the portions…",
  "Counting the macros…",
  "Checking for hidden oils…",
  "Almost there…",
];
let analyzeTimer = null;

function wirePhotoFlow() {
  $("#opt-photo").addEventListener("click", () => { closeSheet(); setTimeout(() => $("#photo-input").click(), 150); });
  $("#photo-input").addEventListener("change", async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      PHOTO.canvas = await AI.fileToCanvas(file, 1280);
    } catch { toast("Couldn't read that photo.", "err"); return; }
    $("#photo-preview").src = PHOTO.canvas.toDataURL("image/jpeg", 0.8);
    $("#photo-note").value = "";
    photoStage("preview");
    openSheet($("#sheet-photo"));
  });

  $("#btn-analyze").addEventListener("click", analyzeMeal);
  $("#btn-retake").addEventListener("click", () => { closeSheet(); setTimeout(() => $("#photo-input").click(), 250); });
  $("#btn-log-meal").addEventListener("click", logAnalyzedMeal);
  $("#photo-note").addEventListener("keydown", e => { if (e.key === "Enter") { e.target.blur(); analyzeMeal(); } });
}

function photoStage(name) {
  $("#photo-stage-preview").classList.toggle("hidden", name !== "preview");
  $("#photo-stage-loading").classList.toggle("hidden", name !== "loading");
  $("#photo-stage-result").classList.toggle("hidden", name !== "result");
  clearInterval(analyzeTimer);
  if (name === "loading") {
    let i = 0;
    $("#analyze-status").textContent = ANALYZE_LINES[0];
    analyzeTimer = setInterval(() => {
      i = (i + 1) % ANALYZE_LINES.length;
      $("#analyze-status").textContent = ANALYZE_LINES[i];
    }, 2600);
  }
}

async function analyzeMeal() {
  if (!PHOTO.canvas) return;
  $("#photo-loading-thumb").src = $("#photo-preview").src;
  photoStage("loading");
  try {
    const b64 = AI.canvasB64(PHOTO.canvas, 0.85);
    const res = await AI.analyzeMeal(b64, $("#photo-note").value);
    if (!res.is_food || !res.items.length) {
      photoStage("preview");
      toast("Claude couldn't find food in that photo — try again.", "err");
      return;
    }
    PHOTO.result = res;
    PHOTO.items = res.items.map(it => ({ ...it }));
    renderMealResult();
    photoStage("result");
  } catch (e) {
    photoStage("preview");
    handleAIError(e);
  }
}

function renderMealResult() {
  const r = PHOTO.result;
  $("#result-title").textContent = r.title || "Your meal";
  const conf = $("#result-conf");
  conf.textContent = r.confidence;
  conf.className = "conf-chip " + r.confidence;
  $("#result-note").textContent = r.notes || "";
  $("#result-note").classList.toggle("hidden", !r.notes);

  $("#result-items").innerHTML = PHOTO.items.map((it, i) => `
    <div class="result-item">
      <div class="ri-info"><div class="ri-name">${esc(it.name)}</div><div class="ri-portion">${esc(it.portion)}</div></div>
      <span class="ri-kcal">${fmt(it.calories)}</span>
      ${PHOTO.items.length > 1 ? `<button class="ri-x" data-i="${i}" aria-label="Remove ${esc(it.name)}">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
      </button>` : ""}
    </div>`).join("");
  $$("#result-items .ri-x").forEach(b => b.addEventListener("click", ev => {
    ev.stopPropagation();
    PHOTO.items.splice(+b.dataset.i, 1);
    renderMealResult();
  }));

  const tot = mealTotals();
  $("#result-kcal").textContent = fmt(tot.kcal);
  $("#result-macros").innerHTML =
    `<span class="mp">P ${Math.round(tot.p)}g</span><span class="mc">C ${Math.round(tot.c)}g</span><span class="mf">F ${Math.round(tot.f)}g</span>`;
}

function mealTotals() {
  return PHOTO.items.reduce((t, it) => ({
    kcal: t.kcal + (it.calories || 0), p: t.p + (it.protein_g || 0),
    c: t.c + (it.carbs_g || 0), f: t.f + (it.fat_g || 0),
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function logAnalyzedMeal() {
  const tot = mealTotals();
  if (tot.kcal <= 0) { toast("Nothing left to log.", "err"); return; }
  Store.addEntry(Store.todayKey(), {
    name: PHOTO.result.title || "Meal",
    kcal: Math.round(tot.kcal), p: Math.round(tot.p), c: Math.round(tot.c), f: Math.round(tot.f),
    src: "photo",
    thumb: AI.thumbFrom(PHOTO.canvas),
    note: PHOTO.result.notes || "",
  });
  closeSheet();
  renderToday(false);
  celebrateLog(tot.kcal);
}

function handleAIError(e) {
  toast(e.message || "Something went wrong.", "err");
  if (e.code === "auth" || e.code === "nokey") setTimeout(openSettings, 900);
}

/* ═══════════════════ live label scan ═══════════════════ */

const SCAN = { stream: null, on: false, busy: false, timer: null, found: null, servings: 1, statusTimer: null, statusIdx: 0 };
const SCAN_LINES = ["Point at a Nutrition Facts label", "Hold steady", "Get the whole panel in frame"];

function wireScan() {
  $("#opt-scan").addEventListener("click", () => { closeSheet(); setTimeout(startScan, 200); });
  $("#scan-close").addEventListener("click", stopScan);
  $("#scan-again").addEventListener("click", resumeScan);
  $("#scan-log").addEventListener("click", logScan);
  $("#serv-minus").addEventListener("click", () => setServings(SCAN.servings - 0.5));
  $("#serv-plus").addEventListener("click", () => setServings(SCAN.servings + 0.5));
  $("#scan-torch").addEventListener("click", toggleTorch);
}

async function startScan() {
  const sheet = $("#sheet-scan");
  sheet.classList.remove("hidden", "found");
  $("#scan-result").classList.add("hidden");
  $("#scan-status").classList.remove("hidden");
  try {
    SCAN.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch {
    sheet.classList.add("hidden");
    toast("Camera access was blocked — allow it in Settings → Safari.", "err");
    return;
  }
  const video = $("#scan-video");
  video.srcObject = SCAN.stream;
  try { await video.play(); } catch {}

  const track = SCAN.stream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    $("#scan-torch").classList.toggle("hidden", !caps.torch);
  } catch { $("#scan-torch").classList.add("hidden"); }

  SCAN.on = true; SCAN.busy = false; SCAN.found = null;
  SCAN.statusIdx = 0;
  setScanStatus(SCAN_LINES[0], false);
  clearInterval(SCAN.statusTimer);
  SCAN.statusTimer = setInterval(() => {
    if (SCAN.busy || SCAN.found) return;
    SCAN.statusIdx = (SCAN.statusIdx + 1) % SCAN_LINES.length;
    setScanStatus(SCAN_LINES[SCAN.statusIdx], false);
  }, 4200);
  scheduleFrame(1400);
}

function setScanStatus(txt, reading) {
  const el = $("#scan-status");
  el.textContent = txt;
  el.classList.toggle("reading", reading);
}

function scheduleFrame(delay) {
  clearTimeout(SCAN.timer);
  SCAN.timer = setTimeout(captureFrame, delay);
}

async function captureFrame() {
  if (!SCAN.on || SCAN.busy || SCAN.found) return;
  const video = $("#scan-video");
  if (!video.videoWidth) { scheduleFrame(600); return; }
  SCAN.busy = true;
  setScanStatus("Reading", true);
  try {
    const cv = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    cv.width = Math.round(video.videoWidth * scale);
    cv.height = Math.round(video.videoHeight * scale);
    cv.getContext("2d").drawImage(video, 0, 0, cv.width, cv.height);
    const res = await AI.scanLabel(AI.canvasB64(cv, 0.8));
    if (!SCAN.on) return;
    if (res.found && res.calories > 0) {
      foundLabel(res);
      return;
    }
    setScanStatus(SCAN_LINES[SCAN.statusIdx], false);
  } catch (e) {
    if (!SCAN.on) return;
    if (e.code === "auth" || e.code === "nokey") { stopScan(); handleAIError(e); return; }
    setScanStatus(SCAN_LINES[SCAN.statusIdx], false);
  } finally {
    SCAN.busy = false;
    if (SCAN.on && !SCAN.found) scheduleFrame(2400);
  }
}

function foundLabel(res) {
  SCAN.found = res;
  SCAN.servings = 1;
  buzz([16, 70, 16]);
  $("#sheet-scan").classList.add("found");
  $("#scan-status").classList.add("hidden");
  $("#scan-name").textContent = res.product_name || "Scanned item";
  $("#scan-serving").textContent = res.serving_size ? `Per serving · ${res.serving_size}` : "Per serving";
  renderScanTotals();
  $("#scan-result").classList.remove("hidden");
}

function setServings(v) {
  SCAN.servings = clamp(Math.round(v * 2) / 2, 0.5, 20);
  buzz(8);
  renderScanTotals();
}

function renderScanTotals() {
  const r = SCAN.found; if (!r) return;
  const s = SCAN.servings;
  $("#serv-count").textContent = s % 1 === 0 ? s : s.toFixed(1);
  $(".stepper-val span").textContent = s === 1 ? "serving" : "servings";
  $("#scan-kcal").textContent = fmt(r.calories * s);
  $("#scan-macros").innerHTML =
    `<span class="mp">P ${Math.round(r.protein_g * s)}g</span><span class="mc">C ${Math.round(r.carbs_g * s)}g</span><span class="mf">F ${Math.round(r.fat_g * s)}g</span>`;
}

function resumeScan() {
  SCAN.found = null;
  $("#sheet-scan").classList.remove("found");
  $("#scan-result").classList.add("hidden");
  $("#scan-status").classList.remove("hidden");
  setScanStatus(SCAN_LINES[0], false);
  scheduleFrame(700);
}

function logScan() {
  const r = SCAN.found; if (!r) return;
  const s = SCAN.servings;
  Store.addEntry(Store.todayKey(), {
    name: r.product_name || "Scanned item",
    kcal: Math.round(r.calories * s), p: Math.round(r.protein_g * s),
    c: Math.round(r.carbs_g * s), f: Math.round(r.fat_g * s),
    src: "scan",
  });
  stopScan();
  renderToday(false);
  celebrateLog(r.calories * s);
}

function stopScan() {
  SCAN.on = false;
  clearTimeout(SCAN.timer);
  clearInterval(SCAN.statusTimer);
  if (SCAN.stream) { SCAN.stream.getTracks().forEach(t => t.stop()); SCAN.stream = null; }
  $("#scan-video").srcObject = null;
  $("#scan-torch").classList.remove("on");
  $("#sheet-scan").classList.add("hidden");
}

async function toggleTorch() {
  const track = SCAN.stream?.getVideoTracks()[0];
  if (!track) return;
  const on = !$("#scan-torch").classList.contains("on");
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    $("#scan-torch").classList.toggle("on", on);
  } catch {}
}

/* ═══════════════════ manual add ═══════════════════ */

function wireManual() {
  $("#opt-manual").addEventListener("click", () => {
    ["#man-name", "#man-kcal", "#man-p", "#man-c", "#man-f"].forEach(s => $(s).value = "");
    $("#man-log").disabled = true;
    openSheet($("#sheet-manual"));
    setTimeout(() => $("#man-name").focus(), 480);
  });
  $("#man-kcal").addEventListener("input", () => { $("#man-log").disabled = !(+$("#man-kcal").value > 0); });
  $("#man-log").addEventListener("click", () => {
    const kcal = +$("#man-kcal").value;
    if (!(kcal > 0)) return;
    Store.addEntry(Store.todayKey(), {
      name: $("#man-name").value.trim() || "Quick add",
      kcal: Math.round(kcal),
      p: Math.round(+$("#man-p").value || 0), c: Math.round(+$("#man-c").value || 0), f: Math.round(+$("#man-f").value || 0),
      src: "manual",
    });
    closeSheet();
    renderToday(false);
    celebrateLog(kcal);
  });
}

/* ═══════════════════ entry detail ═══════════════════ */

let editingEntry = null;

function wireEntrySheet() {
  $("#entry-save").addEventListener("click", () => {
    if (!editingEntry) return;
    const { entry } = editingEntry;
    entry.name = $("#entry-name").value.trim() || entry.name;
    entry.kcal = Math.max(0, Math.round(+$("#entry-kcal").value || 0));
    entry.p = Math.max(0, Math.round(+$("#entry-p").value || 0));
    entry.c = Math.max(0, Math.round(+$("#entry-c").value || 0));
    entry.f = Math.max(0, Math.round(+$("#entry-f").value || 0));
    Store.saveDays();
    closeSheet();
    renderToday(false); renderHistory();
    toast("Updated", "ok");
  });
  $("#entry-delete").addEventListener("click", async () => {
    if (!editingEntry) return;
    const { dateKey, entry } = editingEntry;
    closeSheet();
    const yes = await showConfirm("Delete this entry?", `“${entry.name}” — ${fmt(entry.kcal)} kcal`);
    if (yes) {
      Store.removeEntry(dateKey, entry.id);
      renderToday(false); renderHistory();
      toast("Deleted", "ok");
    }
  });
}

function openEntry(id) {
  const hit = Store.findEntry(id);
  if (!hit) return;
  editingEntry = hit;
  const e = hit.entry;
  const th = $("#entry-thumb");
  th.style.backgroundImage = e.thumb ? `url('${e.thumb}')` : "none";
  th.innerHTML = e.thumb ? "" : (SRC_ICONS[e.src] || SRC_ICONS.manual);
  th.style.display = "grid"; th.style.placeItems = "center"; th.style.color = "var(--ink-3)";
  $("#entry-name").value = e.name;
  const d = new Date(e.t);
  $("#entry-time").textContent = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("#entry-kcal").value = e.kcal;
  $("#entry-p").value = e.p || "";
  $("#entry-c").value = e.c || "";
  $("#entry-f").value = e.f || "";
  openSheet($("#sheet-entry"));
}

/* ═══════════════════ history ═══════════════════ */

function renderHistory() {
  const chart = $("#week-chart");
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const k = Store.todayKey(-i);
    days.push({ k, t: Store.totals(k), goal: Store.goalFor(k), isToday: i === 0 });
  }
  const base = Store.profile.goalKcal;
  const scale = Math.max(base * 1.25, ...days.map(d => d.t.kcal)) || 1;
  const avgDays = days.filter(d => d.t.n > 0);
  $("#chart-avg").textContent = avgDays.length
    ? `avg ${fmt(avgDays.reduce((s, d) => s + d.t.kcal, 0) / avgDays.length)} kcal`
    : "";

  // Bars and the goal line share one plot area: chart height minus the value
  // row above (19px) and the weekday row below (19px).
  const gFrac = clamp(base / scale, 0, 1);
  chart.innerHTML = `<div class="chart-goal" style="bottom:calc(19px + (100% - 38px) * ${gFrac})"><em>GOAL</em></div>` +
    days.map(d => {
      const day = new Date(d.k + "T12:00:00").toLocaleDateString("en-US", { weekday: "narrow" });
      const frac = clamp(d.t.kcal / scale, 0, 1);
      const over = d.t.kcal > d.goal;
      return `<div class="chart-col ${d.isToday ? "today" : ""} ${over ? "over" : ""}">
        <span class="chart-val">${d.isToday && d.t.kcal ? fmt(d.t.kcal) : ""}</span>
        <div class="chart-bar" style="height:calc((100% - 38px) * ${frac})"></div>
        <span class="chart-day">${day}</span>
      </div>`;
    }).join("");

  // past day cards (last 30 days, newest first, skipping today)
  const listEl = $("#history-list");
  const cards = [];
  for (let i = 1; i <= 30; i++) {
    const k = Store.todayKey(-i);
    const d = Store.days[k];
    if (!d || !d.entries.length) continue;
    const t = Store.totals(k);
    const goal = Store.goalFor(k);
    const date = new Date(k + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const over = t.kcal > goal;
    cards.push(`<div class="card day-card">
      <button class="day-head" data-k="${k}">
        <span class="day-title">${date}</span>
        ${d.ex ? '<svg class="day-flame" viewBox="0 0 24 24"><path d="M12 2s1 3.2-1.5 6C8.2 10.5 7 12.3 7 14.5a5 5 0 0 0 10 0c0-1.6-.6-2.9-1.4-4-.3 1-.9 1.9-1.8 2.4.4-2.5-.3-5.8-1.8-7.9z" fill="currentColor"/></svg>' : ""}
        <span class="day-kcal">${fmt(t.kcal)} / ${fmt(goal)}</span>
        <span class="day-chip ${over ? "over" : "under"}">${over ? "+" + fmt(t.kcal - goal) : "✓"}</span>
      </button>
      <div class="day-entries hidden">${d.entries.map(e => mealRowHTML(e, 0)).join("")}</div>
    </div>`);
  }
  listEl.innerHTML = cards.join("");
  $("#history-empty").classList.toggle("hidden", cards.length > 0);
  $$(".day-head", listEl).forEach(h => h.addEventListener("click", () => {
    h.nextElementSibling.classList.toggle("hidden");
  }));
  $$(".day-entries .meal-row", listEl).forEach(r => r.addEventListener("click", () => openEntry(r.dataset.id)));
}

/* ═══════════════════ settings ═══════════════════ */

function wireSettings() {
  segWire($("#set-sex"), v => { Store.profile.sex = v; saveSettings(); });
  segWire($("#set-units"), v => { Store.profile.units = v; Store.saveProfile(); populateSettings(); });
  segWire($("#set-model"), v => { Store.profile.model = v; Store.saveProfile(); $("#model-hint").textContent = AI.MODEL_HINTS[v]; });

  const bind = (id, fn) => $(id).addEventListener("change", e => { fn(e.target.value); saveSettings(); });
  bind("#set-name", v => Store.profile.name = v.trim() || Store.profile.name);
  bind("#set-age", v => Store.profile.age = clamp(+v || Store.profile.age, 13, 110));
  bind("#set-height", v => {
    const n = +v || 0;
    if (n > 0) Store.profile.heightCm = Store.profile.units === "us" ? Math.round(n * 2.54) : Math.round(n);
  });
  bind("#set-weight", v => {
    const n = +v || 0;
    if (n > 0) Store.profile.weightKg = Store.profile.units === "us" ? Math.round(n * 0.45359 * 10) / 10 : n;
  });
  bind("#set-goal", v => { const n = +v; if (n >= 800 && n <= 8000) Store.profile.goalKcal = Math.round(n); });
  bind("#set-p", v => Store.profile.macroP = +v > 0 ? Math.round(+v) : null);
  bind("#set-c", v => Store.profile.macroC = +v > 0 ? Math.round(+v) : null);
  bind("#set-f", v => Store.profile.macroF = +v > 0 ? Math.round(+v) : null);
  bind("#set-bonus", v => Store.profile.bonus = Math.max(0, Math.round(+v || 0)));

  $("#set-key-btn").addEventListener("click", () => {
    const row = $("#set-key-btn").parentElement;
    row.innerHTML = `<label>API key</label><input id="set-key-input" type="text" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…">`;
    const inp = $("#set-key-input");
    inp.focus();
    const commit = () => {
      const v = inp.value.trim();
      if (v.startsWith("sk-")) { Store.key = v; toast("Key updated", "ok"); }
      row.innerHTML = `<label>API key</label><button class="link-btn" id="set-key-btn2">••••••••</button>`;
      $("#set-key-btn2").addEventListener("click", () => location.reload());
    };
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
  });

  $("#set-key-test").addEventListener("click", async () => {
    const btn = $("#set-key-test");
    btn.textContent = "Testing…";
    try { await AI.testKey(Store.key); btn.textContent = "Working ✓"; toast("Claude is connected", "ok"); }
    catch (e) { btn.textContent = "Test"; toast(e.message, "err"); }
    setTimeout(() => btn.textContent = "Test", 2500);
  });

  $("#set-reset").addEventListener("click", async () => {
    closeSheet();
    const yes = await showConfirm("Reset everything?", "Your profile, log history and API key will be wiped from this device. This can't be undone.", "Reset");
    if (yes) { Store.resetAll(); location.reload(); }
  });
}

function saveSettings() {
  Store.saveProfile();
  renderToday(false);
  renderHistory();
}

function populateSettings() {
  const p = Store.profile;
  $("#set-name").value = p.name;
  segSet($("#set-sex"), p.sex);
  $("#set-age").value = p.age;
  segSet($("#set-units"), p.units);
  const us = p.units === "us";
  $$(".unit-echo").forEach(el => {
    el.textContent = el.dataset.u === "height" ? (us ? "(in)" : "(cm)") : (us ? "(lb)" : "(kg)");
  });
  $("#set-height").value = us ? Math.round(p.heightCm / 2.54) : p.heightCm;
  $("#set-weight").value = us ? Math.round(p.weightKg / 0.45359) : p.weightKg;
  $("#set-goal").value = p.goalKcal;
  $("#set-p").value = p.macroP || "";
  $("#set-c").value = p.macroC || "";
  $("#set-f").value = p.macroF || "";
  $("#set-bonus").value = p.bonus;
  segSet($("#set-model"), p.model || "best");
  $("#model-hint").textContent = AI.MODEL_HINTS[p.model || "best"];
}

function openSettings() {
  populateSettings();
  openSheet($("#sheet-settings"));
}

/* ═══════════════════ toast ═══════════════════ */

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("#toast-wrap").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
