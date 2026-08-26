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
  Sync.load();
  applyTheme(Store.flags.theme || "system");
  registerSW();
  wireAuthForms();
  wireSheetDrag();
  buildHeightSelects();
  wireOnboarding();
  wireApp();
  wireSheets();
  wirePhotoFlow();
  wireScan();
  wireManual();
  wireEntrySheet();
  wireSettings();
  wireWeight();

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
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    }).catch(() => {});
  }
}

const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const IS_STANDALONE = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

/* ═══════════════════ theme ═══════════════════ */

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.dataset.theme = mode;
  else delete root.dataset.theme;
  const dark = mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  $$('meta[name="theme-color"]').forEach(m => m.setAttribute("content", dark ? "#0F1013" : "#F6F6F4"));
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyTheme(Store.flags.theme || "system");
});

/* ═══════════════════ cloud sync ═══════════════════ */

const Sync = {
  quiet: false, dirtyDays: new Set(), dirtyRoot: false, timer: null, busy: false,

  load() {
    try {
      const d = JSON.parse(localStorage.getItem("bite.dirty") || "null");
      if (d) { this.dirtyDays = new Set(d.days || []); this.dirtyRoot = !!d.root; }
    } catch {}
  },
  persist() {
    localStorage.setItem("bite.dirty", JSON.stringify({ days: [...this.dirtyDays], root: this.dirtyRoot }));
  },
  mark(kind, key) {
    if (this.quiet) return;
    if (kind === "day") this.dirtyDays.add(key); else this.dirtyRoot = true;
    this.persist();
    this.schedule();
  },
  markAll() {
    for (const k of Object.keys(Store.days)) {
      const d = Store.days[k];
      if (d.entries?.length || d.water || d.ex) this.dirtyDays.add(k);
    }
    this.dirtyRoot = true;
    this.persist();
    this.schedule(300);
  },
  schedule(ms = 2500) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
  },
  async flush() {
    if (this.busy || !window.Cloud?.user) return;
    if (!this.dirtyRoot && this.dirtyDays.size === 0) return;
    this.busy = true;
    setAcctStatus("Syncing…");
    try {
      const days = {};
      for (const k of this.dirtyDays) if (Store.days[k]) days[k] = Store.days[k];
      if (Object.keys(days).length) await Cloud.pushDays(days);
      const ts = Date.now();
      await Cloud.pushRoot(Store.profile, Store.favs, Store.weights, ts);
      Store.flags.lastSync = ts; Store.saveFlags();
      this.dirtyDays.clear(); this.dirtyRoot = false; this.persist();
      setAcctStatus("Synced ✓");
    } catch (e) {
      console.warn("Bite sync failed:", e?.code || e);
      setAcctStatus(String(e?.code || "").includes("permission") ? "Blocked — see setup" : "Retrying…");
      this.schedule(30000);
    } finally {
      this.busy = false;
    }
  },
};

function setAcctStatus(txt) {
  const el = $("#acct-status");
  if (el) el.textContent = window.Cloud?.user ? txt : "Off";
}

function refreshAcctUI() {
  const u = window.Cloud?.user;
  $("#acct-email").textContent = u?.email || "Not signed in";
  $("#acct-btn").textContent = u ? "Sign out" : "Sign in";
  setAcctStatus(u ? (Sync.dirtyRoot || Sync.dirtyDays.size ? "Pending…" : "On") : "Off");
}

/* Cloud → local. Cloud wins per section; local-only days survive and get pushed back. */
function mergeCloud(root, cloudDays) {
  Sync.quiet = true;
  const localOnly = [];
  try {
    if (root?.profile) Store.profile = root.profile;
    if (root?.favs?.length) Store.favs = root.favs;
    if (root?.weights?.length) {
      const map = new Map(Store.weights.map(w => [w.d, w.kg]));
      root.weights.forEach(w => map.set(w.d, w.kg));
      Store.weights = [...map.entries()].map(([d, kg]) => ({ d, kg })).sort((a, b) => (a.d < b.d ? -1 : 1));
    }
    for (const k of Object.keys(Store.days)) {
      if (!cloudDays[k] && (Store.days[k].entries?.length || Store.days[k].water || Store.days[k].ex)) localOnly.push(k);
    }
    for (const [k, v] of Object.entries(cloudDays || {})) {
      const loc = Store.days[k];
      if (!loc || (v.entries?.length || 0) >= (loc.entries?.length || 0)) Store.days[k] = v;
      else localOnly.push(k);
    }
    Store.saveProfile(); Store.saveFavs(); Store.saveWeights(); Store.saveDays();
    if (Store.profile && Store.profile.waterGoal == null) Store.profile.waterGoal = 2.5;
  } finally {
    Sync.quiet = false;
  }
  Store.flags.lastSync = root?.updatedAt || Date.now();
  Store.saveFlags();
  if (localOnly.length) { localOnly.forEach(k => Sync.mark("day", k)); Sync.mark("root"); }
}

let cloudBootHandled = false;

window.addEventListener("cloud-auth", async e => {
  const u = e.detail;
  refreshAcctUI();
  if (cloudBootHandled) { if (u) Sync.schedule(500); return; }
  cloudBootHandled = true;

  if (u) {
    if (!Store.profile) {
      // Fresh device (or cleared storage) with a live session — restore everything.
      try {
        const root = await Cloud.pullRoot();
        if (root?.profile) {
          const days = await Cloud.pullDays();
          mergeCloud(root, days);
          $("#onboarding").classList.add("hidden");
          enterApp(false);
          toast("Restored from your account", "ok");
        }
      } catch (err) { console.warn("restore failed", err); }
    } else {
      // Both exist — pull if another device pushed something newer, then flush our queue.
      try {
        const root = await Cloud.pullRoot();
        if (root && (root.updatedAt || 0) > (Store.flags.lastSync || 0)) {
          const days = await Cloud.pullDays();
          mergeCloud(root, days);
          renderToday(false); renderHistory();
        }
      } catch (err) { console.warn("freshness pull failed", err); }
      Sync.schedule(1000);
    }
  } else if (Store.profile && !Store.flags.authLater) {
    setTimeout(() => { if (!openedSheet) openSheet($("#sheet-auth")); }, 900);
  }
});

window.addEventListener("online", () => Sync.schedule(1500));
document.addEventListener("visibilitychange", () => { if (document.hidden) Sync.flush(); });

/* ═══════════════════ onboarding ═══════════════════ */

const OB = { step: 0, name: "", sex: "", age: null, units: "us", ft: 5, in: 8, cm: null, weight: null, activity: 1.375, goal: null, p: null, c: null, f: null, bonus: 300, water: 2.5 };
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
  if (OB.step === 2) ok = OB.name.trim().length > 0 && OB.sex && OB.age >= 13 && OB.age <= 110;
  if (OB.step === 3) ok = obWeightKg() > 20 && obHeightCm() > 80;
  if (OB.step === 4) ok = OB.goal >= 800 && OB.goal <= 8000;
  if (btn) btn.disabled = !ok;
}

/* ═══════════════════ auth forms ═══════════════════ */

function wireAuthForms() {
  wireAuthForm({
    email: "#auth-email", pw: "#auth-pw", go: "#auth-go", swap: "#auth-swap",
    forgot: "#auth-forgot", error: "#auth-error", title: "#auth-title",
    createLabel: "Create account", signinLabel: "Sign in",
    async onDone(mode) {
      if (mode === "signin") {
        try {
          const root = await Cloud.pullRoot();
          if (root?.profile) {
            const days = await Cloud.pullDays();
            mergeCloud(root, days);
            $("#onboarding").classList.add("hidden");
            enterApp(false);
            toast(`Welcome back, ${Store.profile.name} 👋`, "ok");
            return;
          }
        } catch (err) { console.warn(err); }
      }
      goStep(2); validateStep(); // new account (or account with no data yet) → set up profile
    },
  });

  wireAuthForm({
    email: "#sa-email", pw: "#sa-pw", go: "#sa-go", swap: "#sa-swap",
    error: "#sa-error", title: "#sa-title",
    createLabel: "Create account", signinLabel: "Sign in",
    async onDone(mode) {
      closeSheet();
      if (mode === "create") {
        Sync.markAll();
        toast("Account created — syncing your data ✓", "ok");
      } else {
        try {
          const root = await Cloud.pullRoot();
          const days = root ? await Cloud.pullDays() : {};
          mergeCloud(root || {}, days);
          renderToday(false); renderHistory();
        } catch (err) { console.warn(err); }
        Sync.markAll();
        toast("Signed in ✓", "ok");
      }
      refreshAcctUI();
    },
  });

  $("#sa-later").addEventListener("click", () => {
    Store.flags.authLater = true; Store.saveFlags();
    closeSheet();
  });
}

function wireAuthForm(cfg) {
  const email = $(cfg.email), pw = $(cfg.pw), go = $(cfg.go), err = $(cfg.error);
  let mode = "create";

  const validate = () => {
    go.disabled = !(email.value.includes("@") && email.value.includes(".") && pw.value.length >= 6);
  };
  ["input", "change"].forEach(ev => { email.addEventListener(ev, validate); pw.addEventListener(ev, validate); });

  const showErr = msg => { err.textContent = msg; err.classList.toggle("hidden", !msg); };

  $(cfg.swap).addEventListener("click", () => {
    mode = mode === "create" ? "signin" : "create";
    $(cfg.title).textContent = mode === "create" ? "Create your account" : "Welcome back";
    go.textContent = mode === "create" ? cfg.createLabel : cfg.signinLabel;
    $(cfg.swap).innerHTML = mode === "create"
      ? "Already have an account? <strong>Sign in</strong>"
      : "New here? <strong>Create an account</strong>";
    if (cfg.forgot) $(cfg.forgot).classList.toggle("hidden", mode === "create");
    pw.autocomplete = mode === "create" ? "new-password" : "current-password";
    showErr("");
  });

  if (cfg.forgot) $(cfg.forgot).addEventListener("click", async () => {
    if (!email.value.includes("@")) { showErr("Type your email above first."); return; }
    try { await Cloud.resetPassword(email.value.trim()); toast("Reset email sent 📮", "ok"); showErr(""); }
    catch (e) { showErr(Cloud.friendlyError(e)); }
  });

  go.addEventListener("click", async () => {
    if (!window.Cloud) { showErr("Can't reach the account service — check your connection and try again."); return; }
    const label = go.textContent;
    go.disabled = true; go.textContent = mode === "create" ? "Creating…" : "Signing in…";
    showErr("");
    try {
      if (mode === "create") await Cloud.create(email.value.trim(), pw.value);
      else await Cloud.signIn(email.value.trim(), pw.value);
      refreshAcctUI();
      await cfg.onDone(mode);
    } catch (e) {
      showErr(Cloud.friendlyError(e));
    }
    go.textContent = label;
    validate();
  });
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
  $("#ob-water").addEventListener("input", e => { OB.water = clamp(+e.target.value || 2.5, 0.5, 10); });

  $("#ob-finish").addEventListener("click", () => {
    Store.profile = {
      name: OB.name.trim(), sex: OB.sex, age: OB.age,
      heightCm: Math.round(obHeightCm()), weightKg: Math.round(obWeightKg() * 10) / 10,
      units: OB.units, activity: OB.activity,
      goalKcal: OB.goal, macroP: OB.p, macroC: OB.c, macroF: OB.f,
      bonus: OB.bonus, waterGoal: OB.water,
    };
    Store.saveProfile();
    successPop();
    setTimeout(() => enterApp(true), 950);
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

/* Which day new entries land on: 0 = today, -1 = yesterday. Resets each time the add sheet opens. */
let addOffset = 0;
const targetKey = () => Store.todayKey(addOffset);
const entryTime = () => Date.now() + addOffset * 86400000;

function wireApp() {
  $$(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));
  $("#btn-add").addEventListener("click", () => {
    buzz(10);
    addOffset = 0;
    segSet($("#day-toggle"), "0");
    renderFavs();
    openSheet($("#sheet-add"));
  });
  segWire($("#day-toggle"), v => { addOffset = +v; });
  $("#btn-settings").addEventListener("click", openSettings);
  $("#install-banner-x").addEventListener("click", () => {
    Store.flags.bannerDismissed = true; Store.saveFlags();
    $("#install-banner").classList.add("hidden");
  });
  $("#ex-toggle").addEventListener("click", () => {
    const k = Store.todayKey(), d = Store.day(k);
    d.ex = !d.ex;
    Store.saveDays();
    Sync.mark("day", k);
    buzz(12);
    $("#ex-toggle").setAttribute("aria-pressed", String(d.ex));
    renderToday(false);
  });
  $("#water-plus").addEventListener("click", () => adjustWater(0.25));
  $("#water-minus").addEventListener("click", () => adjustWater(-0.25));
}

/* ---- water ---- */

const litres = n => (Math.round(n * 100) / 100).toString();

function adjustWater(delta) {
  const d = Store.day(Store.todayKey());
  d.water = clamp(Math.round(((d.water || 0) + delta) * 100) / 100, 0, 15);
  Store.saveDays();
  Sync.mark("day", Store.todayKey());
  buzz(8);
  if (delta > 0) {
    const ic = $("#water-icon");
    ic.classList.remove("pop"); void ic.offsetWidth; ic.classList.add("pop");
  }
  renderWater();
}

function renderWater() {
  const d = Store.day(Store.todayKey());
  const w = d.water || 0;
  const goal = Store.profile.waterGoal || 2.5;
  $("#water-val").textContent = `${litres(w)} / ${litres(goal)} L`;
  $("#water-fill").style.width = clamp(w / goal * 100, 0, 100) + "%";
  $(".water-card").classList.toggle("done", w >= goal);
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

  renderWater();

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

function celebrateLog(kcal, toYesterday) {
  successPop();
  buzz([14, 60, 14]);
  const wrap = $(".ring-wrap");
  wrap.classList.remove("pulse"); void wrap.offsetWidth; wrap.classList.add("pulse");
  setTimeout(() => toast(`Logged ${fmt(kcal)} kcal${toYesterday ? " to yesterday" : ""}`, "ok"), 500);
}

function afterLog(kcal) {
  renderToday(false);
  if (addOffset !== 0) renderHistory();
  celebrateLog(kcal, addOffset < 0);
}

/* ---- favorites ---- */

function renderFavs() {
  const list = $("#fav-list");
  list.innerHTML = Store.favs.map(f => `
    <div class="fav-row" data-id="${f.id}" role="button" tabindex="0">
      ${f.thumb
        ? `<span class="fav-thumb" style="background-image:url('${f.thumb}')"></span>`
        : `<span class="fav-thumb">${SRC_ICONS[f.src] || SRC_ICONS.manual}</span>`}
      <span class="fav-name">${esc(f.name)}</span>
      <span class="fav-kcal">${fmt(f.kcal)}</span>
      <button class="fav-x" data-x="${f.id}" aria-label="Remove ${esc(f.name)} from favorites">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
      </button>
    </div>`).join("");
  $("#fav-empty").classList.toggle("hidden", Store.favs.length > 0);
  $$(".fav-row", list).forEach(r => r.addEventListener("click", ev => {
    if (ev.target.closest(".fav-x")) return;
    const f = Store.favs.find(x => x.id === r.dataset.id);
    if (!f) return;
    Store.addEntry(targetKey(), { name: f.name, kcal: f.kcal, p: f.p, c: f.c, f: f.f, src: f.src, thumb: f.thumb, favId: f.id, t: entryTime() });
    closeSheet();
    afterLog(f.kcal);
  }));
  $$(".fav-x", list).forEach(b => b.addEventListener("click", ev => {
    ev.stopPropagation();
    Store.removeFav(b.dataset.x);
    buzz(8);
    renderFavs();
  }));
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

/* Swipe-down anywhere on a sheet (when its content is scrolled to the top)
   drags it with your finger and dismisses it — iOS style. */
function wireSheetDrag() {
  $$(".sheet").forEach(sheet => {
    let startY = 0, startX = 0, dy = 0, dragging = false, canDrag = false, t0 = 0;
    const desktop = () => matchMedia("(min-width: 700px)").matches;
    const setY = y => { sheet.style.transform = desktop() ? `translate(-50%, ${y}px)` : `translateY(${y}px)`; };

    sheet.addEventListener("touchstart", e => {
      if (openedSheet !== sheet) return;
      const t = e.touches[0];
      startY = t.clientY; startX = t.clientX; dy = 0; dragging = false; t0 = performance.now();
      const scroller = sheet.classList.contains("tall") ? $(".settings-scroll", sheet) : sheet;
      canDrag = !scroller || scroller.scrollTop <= 0;
    }, { passive: true });

    sheet.addEventListener("touchmove", e => {
      if (openedSheet !== sheet || !canDrag) return;
      const t = e.touches[0];
      const moveY = t.clientY - startY, moveX = t.clientX - startX;
      if (!dragging) {
        if (moveY > 10 && Math.abs(moveY) > Math.abs(moveX) * 1.4) {
          dragging = true;
          sheet.style.transition = "none";
        } else if (moveY < -6) { canDrag = false; return; }
        else return;
      }
      dy = Math.max(0, moveY - 10);
      setY(dy);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    const end = () => {
      if (!dragging) { canDrag = false; return; }
      dragging = false;
      const vel = dy / Math.max(1, performance.now() - t0);
      if (dy > 130 || (dy > 45 && vel > 0.45)) {
        openedSheet = null;
        $("#backdrop").classList.remove("show");
        sheet.style.transition = "transform .28s ease-in";
        setY(window.innerHeight);
        setTimeout(() => {
          sheet.classList.remove("show");
          sheet.classList.add("hidden");
          sheet.style.transition = ""; sheet.style.transform = "";
          if (!openedSheet) $("#backdrop").classList.add("hidden");
        }, 290);
      } else {
        sheet.style.transition = "transform .45s var(--spring)";
        sheet.style.transform = "";
        setTimeout(() => { if (!dragging) sheet.style.transition = ""; }, 460);
      }
    };
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
  });
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

const PHOTO = { canvas: null, result: null, items: [], override: null };
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
  $("#opt-library").addEventListener("click", () => { closeSheet(); setTimeout(() => $("#library-input").click(), 150); });
  const onPick = async e => {
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
  };
  $("#photo-input").addEventListener("change", onPick);
  $("#library-input").addEventListener("change", onPick);

  $("#btn-analyze").addEventListener("click", analyzeMeal);
  $("#btn-retake").addEventListener("click", () => { closeSheet(); setTimeout(() => $("#photo-input").click(), 250); });
  $("#btn-log-meal").addEventListener("click", logAnalyzedMeal);
  $("#photo-note").addEventListener("keydown", e => { if (e.key === "Enter") { e.target.blur(); analyzeMeal(); } });
  $("#result-kcal").addEventListener("input", () => {
    const v = Math.round(+$("#result-kcal").value || 0);
    PHOTO.override = v > 0 ? v : null;
    renderResultMacros();
  });
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

  PHOTO.override = null;
  $("#result-kcal").value = Math.round(mealTotals().kcal);
  renderResultMacros();
}

function resultRatio() {
  const est = mealTotals().kcal;
  return PHOTO.override != null && est > 0 ? PHOTO.override / est : 1;
}

function renderResultMacros() {
  const tot = mealTotals(), r = resultRatio();
  $("#result-macros").innerHTML =
    `<span class="mp">P ${Math.round(tot.p * r)}g</span><span class="mc">C ${Math.round(tot.c * r)}g</span><span class="mf">F ${Math.round(tot.f * r)}g</span>`;
}

function mealTotals() {
  return PHOTO.items.reduce((t, it) => ({
    kcal: t.kcal + (it.calories || 0), p: t.p + (it.protein_g || 0),
    c: t.c + (it.carbs_g || 0), f: t.f + (it.fat_g || 0),
  }), { kcal: 0, p: 0, c: 0, f: 0 });
}

function logAnalyzedMeal() {
  const tot = mealTotals(), r = resultRatio();
  const kcal = PHOTO.override != null ? PHOTO.override : tot.kcal;
  if (kcal <= 0) { toast("Nothing left to log.", "err"); return; }
  Store.addEntry(targetKey(), {
    name: PHOTO.result.title || "Meal",
    kcal: Math.round(kcal), p: Math.round(tot.p * r), c: Math.round(tot.c * r), f: Math.round(tot.f * r),
    src: "photo",
    thumb: AI.thumbFrom(PHOTO.canvas),
    note: PHOTO.result.notes || "",
    t: entryTime(),
  });
  closeSheet();
  afterLog(kcal);
}

function handleAIError(e) {
  toast(e.message || "Something went wrong.", "err");
}

/* ═══════════════════ live label scan ═══════════════════ */

const SCAN = { stream: null, on: false, busy: false, timer: null, found: null, thumb: null, servings: 1, statusTimer: null, statusIdx: 0 };
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

  SCAN.on = true; SCAN.busy = false; SCAN.found = null; SCAN.thumb = null;
  SCAN.statusIdx = 0; SCAN.misses = 0; SCAN.lastCode = "";
  SCAN.lines = [...SCAN_LINES];
  setScanStatus(SCAN.lines[0], false);
  clearInterval(SCAN.statusTimer);
  SCAN.statusTimer = setInterval(() => {
    if (SCAN.busy || SCAN.found) return;
    SCAN.statusIdx = (SCAN.statusIdx + 1) % SCAN.lines.length;
    setScanStatus(SCAN.lines[SCAN.statusIdx], false);
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
      SCAN.thumb = AI.thumbFrom(cv); // keep the frame that was read, as the entry's photo
      foundLabel(res, false);
      return;
    }
    // Label unreadable — fall back to a visible barcode, looked up on OpenFoodFacts.
    const code = (res.barcode || "").replace(/\D/g, "");
    if (code.length >= 8 && code !== SCAN.lastCode) {
      SCAN.lastCode = code;
      setScanStatus("Barcode spotted — looking it up", true);
      const prod = await AI.lookupBarcode(code).catch(() => null);
      if (!SCAN.on) return;
      if (prod) {
        SCAN.thumb = AI.thumbFrom(cv);
        foundLabel(prod, prod.per100);
        return;
      }
      setScanStatus("Not in the barcode database — try the label", false);
    } else {
      SCAN.misses++;
      if (SCAN.misses === 3 && SCAN.lines.length === SCAN_LINES.length) {
        SCAN.lines.push("Can't read the label? Aim at the barcode instead");
        SCAN.statusIdx = SCAN.lines.length - 1;
      }
      setScanStatus(SCAN.lines[SCAN.statusIdx], false);
    }
  } catch (e) {
    if (!SCAN.on) return;
    if (e.code === "auth" || e.code === "nokey") { stopScan(); handleAIError(e); return; }
    setScanStatus(SCAN.lines[SCAN.statusIdx], false);
  } finally {
    SCAN.busy = false;
    if (SCAN.on && !SCAN.found) scheduleFrame(2400);
  }
}

function foundLabel(res, per100) {
  SCAN.found = res;
  SCAN.per100 = !!per100;
  SCAN.servings = 1;
  buzz([16, 70, 16]);
  $("#sheet-scan").classList.add("found");
  $("#scan-status").classList.add("hidden");
  $("#scan-name").textContent = res.product_name || "Scanned item";
  $("#scan-serving").textContent = per100
    ? "Values per 100 g"
    : (res.serving_size ? `Per serving · ${res.serving_size}` : "Per serving");
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
  $(".stepper-val span").textContent = SCAN.per100 ? "× 100 g" : (s === 1 ? "serving" : "servings");
  $("#scan-kcal").textContent = fmt(r.calories * s);
  $("#scan-macros").innerHTML =
    `<span class="mp">P ${Math.round(r.protein_g * s)}g</span><span class="mc">C ${Math.round(r.carbs_g * s)}g</span><span class="mf">F ${Math.round(r.fat_g * s)}g</span>`;
}

function resumeScan() {
  SCAN.found = null;
  SCAN.thumb = null;
  $("#sheet-scan").classList.remove("found");
  $("#scan-result").classList.add("hidden");
  $("#scan-status").classList.remove("hidden");
  setScanStatus(SCAN_LINES[0], false);
  scheduleFrame(700);
}

function logScan() {
  const r = SCAN.found; if (!r) return;
  const s = SCAN.servings;
  Store.addEntry(targetKey(), {
    name: r.product_name || "Scanned item",
    kcal: Math.round(r.calories * s), p: Math.round(r.protein_g * s),
    c: Math.round(r.carbs_g * s), f: Math.round(r.fat_g * s),
    src: "scan",
    thumb: SCAN.thumb || undefined,
    t: entryTime(),
  });
  stopScan();
  afterLog(r.calories * s);
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
    Store.addEntry(targetKey(), {
      name: $("#man-name").value.trim() || "Quick add",
      kcal: Math.round(kcal),
      p: Math.round(+$("#man-p").value || 0), c: Math.round(+$("#man-c").value || 0), f: Math.round(+$("#man-f").value || 0),
      src: "manual",
      t: entryTime(),
    });
    closeSheet();
    afterLog(kcal);
  });

  $("#man-ai").addEventListener("click", async () => {
    const txt = $("#man-name").value.trim();
    if (!txt) { toast("Describe it first — e.g. '2 eggs and toast'", "err"); return; }
    const btn = $("#man-ai"), label = $("#man-ai span");
    btn.disabled = true; label.textContent = "Estimating…";
    try {
      const res = await AI.describeMeal(txt);
      if (!res.is_food || !res.items.length) {
        toast("Claude couldn't read that as food — try rewording.", "err");
      } else {
        const t = res.items.reduce((a, it) => ({
          kcal: a.kcal + it.calories, p: a.p + it.protein_g, c: a.c + it.carbs_g, f: a.f + it.fat_g,
        }), { kcal: 0, p: 0, c: 0, f: 0 });
        if (res.title) $("#man-name").value = res.title;
        $("#man-kcal").value = Math.round(t.kcal);
        $("#man-p").value = Math.round(t.p);
        $("#man-c").value = Math.round(t.c);
        $("#man-f").value = Math.round(t.f);
        $("#man-log").disabled = !(t.kcal > 0);
        buzz(10);
      }
    } catch (e) { handleAIError(e); }
    btn.disabled = false; label.textContent = "Estimate with Claude";
  });
}

/* ═══════════════════ entry detail ═══════════════════ */

let editingEntry = null;

function wireEntrySheet() {
  $("#entry-star").addEventListener("click", () => {
    if (!editingEntry) return;
    const en = editingEntry.entry;
    const on = !!(en.favId && Store.hasFav(en.favId));
    if (on) {
      Store.removeFav(en.favId);
      delete en.favId;
    } else {
      en.favId = Store.addFav(en).id;
      toast("Saved to favorites ★", "ok");
    }
    Store.saveDays();
    Sync.mark("day", editingEntry.dateKey);
    buzz(10);
    $("#entry-star").setAttribute("aria-pressed", String(!on));
  });

  $("#entry-save").addEventListener("click", () => {
    if (!editingEntry) return;
    const { entry } = editingEntry;
    entry.name = $("#entry-name").value.trim() || entry.name;
    entry.kcal = Math.max(0, Math.round(+$("#entry-kcal").value || 0));
    entry.p = Math.max(0, Math.round(+$("#entry-p").value || 0));
    entry.c = Math.max(0, Math.round(+$("#entry-c").value || 0));
    entry.f = Math.max(0, Math.round(+$("#entry-f").value || 0));
    Store.saveDays();
    Sync.mark("day", editingEntry.dateKey);
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
  $("#entry-star").setAttribute("aria-pressed", String(!!(e.favId && Store.hasFav(e.favId))));
  openSheet($("#sheet-entry"));
}

/* ═══════════════════ history ═══════════════════ */

/* ---- weight ---- */

function wireWeight() {
  $("#btn-log-weight").addEventListener("click", () => {
    const us = Store.profile.units === "us";
    $("#weight-input-unit").textContent = us ? "(lb)" : "(kg)";
    $("#weight-input").value = "";
    $("#weight-input").placeholder = us ? Math.round(Store.profile.weightKg / 0.45359) : Store.profile.weightKg;
    openSheet($("#sheet-weight"));
    setTimeout(() => $("#weight-input").focus(), 480);
  });
  $("#weight-input").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
  $("#weight-save").addEventListener("click", () => {
    const us = Store.profile.units === "us";
    const v = +$("#weight-input").value;
    if (!(v > 20 && v < (us ? 1500 : 700))) { toast("Enter a weight first", "err"); return; }
    Store.logWeight(Math.round((us ? v * 0.45359 : v) * 10) / 10);
    closeSheet();
    renderHistory();
    toast("Weight logged", "ok");
  });
}

function renderWeightCard() {
  const p = Store.profile, us = p.units === "us";
  const toUnit = kg => us ? Math.round(kg / 0.45359) : Math.round(kg * 10) / 10;
  $("#weight-now-unit").textContent = us ? "lb" : "kg";
  const pts = Store.weights.slice(-60);
  const last = pts[pts.length - 1];
  $("#weight-now").textContent = last ? toUnit(last.kg) : "—";
  const svg = $("#weight-spark");
  const hint = $("#weight-hint");
  if (pts.length < 2) {
    svg.innerHTML = "";
    hint.textContent = pts.length ? "Log again tomorrow to start your trend." : "Log your weight to start the trend line.";
    return;
  }
  const kgs = pts.map(w => w.kg);
  const min = Math.min(...kgs), max = Math.max(...kgs);
  const pad = Math.max((max - min) * 0.2, 0.4);
  const y = v => 50 - ((v - (min - pad)) / ((max - min) + pad * 2)) * 46;
  const x = i => 4 + (i / (pts.length - 1)) * 192;
  svg.innerHTML =
    `<polyline vector-effect="non-scaling-stroke" points="${pts.map((w, i) => `${x(i).toFixed(1)},${y(w.kg).toFixed(1)}`).join(" ")}"/>` +
    `<circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.kg).toFixed(1)}" r="3"/>`;
  const delta = last.kg - pts[0].kg;
  const span = Math.max(1, Math.round((new Date(last.d) - new Date(pts[0].d)) / 86400000));
  const amt = us ? Math.abs(delta) / 0.45359 : Math.abs(delta);
  hint.textContent = Math.abs(delta) < 0.05
    ? `Steady over the last ${span} day${span > 1 ? "s" : ""}`
    : `${delta < 0 ? "Down" : "Up"} ${Math.round(amt * 10) / 10} ${us ? "lb" : "kg"} over ${span} day${span > 1 ? "s" : ""}`;
}

function renderHistory() {
  renderWeightCard();
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
        ${d.water > 0 ? `<span class="day-water"><svg viewBox="0 0 24 24"><path d="M12 2.7S6 9.6 6 14a6 6 0 0 0 12 0c0-4.4-6-11.3-6-11.3z" fill="currentColor"/></svg>${litres(d.water)}L</span>` : ""}
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
  bind("#set-water", v => { const n = +v; if (n >= 0.5 && n <= 10) Store.profile.waterGoal = Math.round(n * 100) / 100; });

  $("#settings-done").addEventListener("click", closeSheet);

  segWire($("#set-theme"), v => {
    Store.flags.theme = v;
    Store.saveFlags();
    applyTheme(v);
  });

  $("#acct-btn").addEventListener("click", async () => {
    if (window.Cloud?.user) {
      closeSheet();
      const yes = await showConfirm("Sign out?", "Your data stays on this phone and in your account — it just stops syncing until you sign in again.", "Sign out");
      if (yes) {
        try { await Cloud.signOutUser(); } catch {}
        Store.flags.authLater = true; Store.saveFlags();
        refreshAcctUI();
        toast("Signed out", "ok");
      }
    } else {
      openSheet($("#sheet-auth"));
    }
  });

  $("#set-reset").addEventListener("click", async () => {
    closeSheet();
    const yes = await showConfirm("Reset everything?", "Wipes this phone's data and signs out. Your account's cloud copy is not deleted.", "Reset");
    if (yes) {
      try { await window.Cloud?.signOutUser(); } catch {}
      Store.resetAll();
      localStorage.removeItem("bite.dirty");
      location.reload();
    }
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
  $("#set-water").value = p.waterGoal || 2.5;
  segSet($("#set-theme"), Store.flags.theme || "system");
}

function openSettings() {
  populateSettings();
  refreshAcctUI();
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
