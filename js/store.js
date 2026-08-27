/* Bite · store.js — profile, day log, persistence (localStorage only) */
"use strict";

const Store = {
  profile: null,   // {name, sex, age, heightCm, weightKg, units, activity, goalKcal, macroP, macroC, macroF, bonus, model}
  days: {},        // { "2026-08-26": { ex:false, entries:[{id,t,name,kcal,p,c,f,src,thumb?,note?}] } }
  flags: {},

  load() {
    try { this.profile = JSON.parse(localStorage.getItem("bite.profile") || "null"); } catch { this.profile = null; }
    try { this.days = JSON.parse(localStorage.getItem("bite.days") || "{}"); } catch { this.days = {}; }
    try { this.flags = JSON.parse(localStorage.getItem("bite.flags") || "{}"); } catch { this.flags = {}; }
    try { this.favs = JSON.parse(localStorage.getItem("bite.favs") || "[]"); } catch { this.favs = []; }
    try { this.weights = JSON.parse(localStorage.getItem("bite.weights") || "[]"); } catch { this.weights = []; }
    if (this.profile && this.profile.waterGoal == null) this.profile.waterGoal = 2.5; // migrate older profiles
    this.pruneThumbs();
  },

  saveProfile() { localStorage.setItem("bite.profile", JSON.stringify(this.profile)); window.Sync?.mark("root"); },
  saveFlags()   { localStorage.setItem("bite.flags", JSON.stringify(this.flags)); },

  saveDays() {
    try {
      localStorage.setItem("bite.days", JSON.stringify(this.days));
    } catch (e) {
      // Quota hit — drop oldest thumbnails first, then retry once.
      const keys = Object.keys(this.days).sort();
      for (const k of keys) {
        for (const en of this.days[k].entries) delete en.thumb;
        try { localStorage.setItem("bite.days", JSON.stringify(this.days)); return; } catch {}
      }
    }
  },

  /* A key pasted by the user (localStorage) wins; otherwise the built-in one. */
  get key() { return localStorage.getItem("bite.key") || (typeof AI !== "undefined" ? AI.seedKey() : ""); },
  set key(v) { localStorage.setItem("bite.key", v || ""); },

  todayKey(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  day(k) {
    if (!this.days[k]) this.days[k] = { ex: false, entries: [], water: 0 };
    return this.days[k];
  },

  addEntry(dateKey, entry) {
    entry.id = "e" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    entry.t = entry.t || Date.now();
    this.day(dateKey).entries.push(entry);
    this.saveDays();
    window.Sync?.mark("day", dateKey);
    return entry;
  },

  removeEntry(dateKey, id) {
    const d = this.day(dateKey);
    d.entries = d.entries.filter(e => e.id !== id);
    this.saveDays();
    window.Sync?.mark("day", dateKey);
  },

  findEntry(id) {
    for (const k of Object.keys(this.days)) {
      const e = this.days[k].entries.find(x => x.id === id);
      if (e) return { dateKey: k, entry: e };
    }
    return null;
  },

  totals(dateKey) {
    const d = this.days[dateKey];
    const t = { kcal: 0, p: 0, c: 0, f: 0, n: 0 };
    if (!d) return t;
    for (const e of d.entries) {
      t.kcal += e.kcal || 0; t.p += e.p || 0; t.c += e.c || 0; t.f += e.f || 0; t.n++;
    }
    return t;
  },

  /* Base goal after the "eat less as you lose weight" reduction:
     25 kcal per kg lost since the feature was switched on, applied per 1 kg
     or per 5 kg chunk (−125). Never drops below 1200. */
  adaptiveGoal() {
    const p = this.profile;
    if (!p) return 2000;
    let g = p.goalKcal;
    if (p.adaptive && p.adaptiveStartKg) {
      const lost = Math.max(0, p.adaptiveStartKg - (p.weightKg || p.adaptiveStartKg));
      const step = p.adaptiveStep === 5 ? 5 : 1;
      const chunks = Math.floor(lost / step + 1e-6);
      g = Math.max(1200, g - chunks * step * 25);
    }
    return g;
  },

  adaptiveReduction() { return this.profile ? this.profile.goalKcal - this.adaptiveGoal() : 0; },

  adaptiveLostKg() {
    const p = this.profile;
    if (!p?.adaptive || !p.adaptiveStartKg) return 0;
    return Math.max(0, Math.round((p.adaptiveStartKg - (p.weightKg || p.adaptiveStartKg)) * 10) / 10);
  },

  /* Today always uses the live goal; past days keep the goal they had (day.g). */
  goalFor(dateKey) {
    const d = this.days[dateKey];
    const live = this.adaptiveGoal();
    const base = dateKey === this.todayKey() ? live : (d?.g ?? live);
    return base + (d && d.ex ? (this.profile?.bonus || 0) : 0);
  },

  /* ---- favorites ---- */

  saveFavs() { localStorage.setItem("bite.favs", JSON.stringify(this.favs)); window.Sync?.mark("root"); },

  addFav(e) {
    const f = {
      id: "f" + Math.random().toString(36).slice(2, 9),
      name: e.name, kcal: e.kcal, p: e.p || 0, c: e.c || 0, f: e.f || 0,
      thumb: e.thumb || undefined, src: e.src || "manual",
    };
    this.favs.unshift(f);
    if (this.favs.length > 30) this.favs.length = 30;
    this.saveFavs();
    return f;
  },

  removeFav(id) {
    this.favs = this.favs.filter(f => f.id !== id);
    this.saveFavs();
  },

  hasFav(id) { return this.favs.some(f => f.id === id); },

  /* ---- weight log ---- */

  saveWeights() { localStorage.setItem("bite.weights", JSON.stringify(this.weights)); window.Sync?.mark("root"); },

  logWeight(kg) {
    const k = this.todayKey();
    const hit = this.weights.find(w => w.d === k);
    if (hit) hit.kg = kg;
    else { this.weights.push({ d: k, kg }); this.weights.sort((a, b) => (a.d < b.d ? -1 : 1)); }
    this.saveWeights();
    if (this.profile) { this.profile.weightKg = kg; this.saveProfile(); }
  },

  /* ---- analytics (Insights tab) ---- */

  shiftKey(k, delta) {
    const [y, m, d] = k.split("-").map(Number);
    const dt = new Date(y, m - 1, d + delta);
    const p = n => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  },

  logged(k) { return (this.days[k]?.entries?.length || 0) > 0; },

  /* Consecutive logged days up to today (today not yet logged doesn't break it). */
  streak() {
    let n = 0, offset = this.logged(this.todayKey()) ? 0 : 1;
    if (offset === 1 && !this.logged(this.todayKey(-1))) return 0;
    while (this.logged(this.todayKey(-offset))) { n++; offset++; }
    return n;
  },

  bestStreak() {
    const set = new Set(Object.keys(this.days).filter(k => this.logged(k)));
    let best = 0;
    for (const k of set) {
      if (set.has(this.shiftKey(k, -1))) continue; // only count from a run's start
      let run = 0, cur = k;
      while (set.has(cur)) { run++; cur = this.shiftKey(cur, 1); }
      best = Math.max(best, run);
    }
    return best;
  },

  weekStats() {
    let sum = 0, logged = 0, onTarget = 0, pSum = 0;
    for (let i = 0; i < 7; i++) {
      const k = this.todayKey(-i), t = this.totals(k);
      if (t.n > 0) { logged++; sum += t.kcal; pSum += t.p; if (t.kcal <= this.goalFor(k)) onTarget++; }
    }
    return { avg: logged ? Math.round(sum / logged) : 0, logged, onTarget, avgP: logged ? Math.round(pSum / logged) : 0 };
  },

  macroAverages(nDays = 14) {
    let p = 0, c = 0, f = 0, days = 0;
    for (let i = 0; i < nDays; i++) {
      const t = this.totals(this.todayKey(-i));
      if (t.n > 0) { p += t.p; c += t.c; f += t.f; days++; }
    }
    if (!days) return null;
    p /= days; c /= days; f /= days;
    const pc = p * 4, cc = c * 4, fc = f * 9, tot = pc + cc + fc || 1;
    return { p: Math.round(p), c: Math.round(c), f: Math.round(f), days,
      pPct: pc / tot, cPct: cc / tot, fPct: fc / tot, kcal: Math.round(pc + cc + fc) };
  },

  trendSeries(nDays = 30) {
    const out = [];
    for (let i = nDays - 1; i >= 0; i--) {
      const k = this.todayKey(-i), t = this.totals(k);
      out.push({ k, kcal: t.kcal, goal: this.goalFor(k), has: t.n > 0 });
    }
    return out;
  },

  /* Mifflin-St Jeor maintenance estimate */
  maintenance(sex, age, heightCm, weightKg, activity) {
    if (!age || !heightCm || !weightKg) return null;
    let bmr = 10 * weightKg + 6.25 * heightCm - 5 * age;
    bmr += sex === "m" ? 5 : sex === "f" ? -161 : -78;
    return Math.round(bmr * (activity || 1.375) / 10) * 10;
  },

  /* Keep photo thumbnails only for the last 21 days to stay under quota */
  pruneThumbs() {
    const cutoff = this.todayKey(-21);
    let changed = false;
    for (const k of Object.keys(this.days)) {
      if (k < cutoff) {
        for (const e of this.days[k].entries) {
          if (e.thumb) { delete e.thumb; changed = true; }
        }
      }
    }
    if (changed) this.saveDays();
  },

  resetAll() {
    localStorage.removeItem("bite.profile");
    localStorage.removeItem("bite.days");
    localStorage.removeItem("bite.flags");
    localStorage.removeItem("bite.key");
    localStorage.removeItem("bite.favs");
    localStorage.removeItem("bite.weights");
  },
};
