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
    this.pruneThumbs();
  },

  saveProfile() { localStorage.setItem("bite.profile", JSON.stringify(this.profile)); },
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
    if (!this.days[k]) this.days[k] = { ex: false, entries: [] };
    return this.days[k];
  },

  addEntry(dateKey, entry) {
    entry.id = "e" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    entry.t = entry.t || Date.now();
    this.day(dateKey).entries.push(entry);
    this.saveDays();
    return entry;
  },

  removeEntry(dateKey, id) {
    const d = this.day(dateKey);
    d.entries = d.entries.filter(e => e.id !== id);
    this.saveDays();
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

  goalFor(dateKey) {
    const base = this.profile ? this.profile.goalKcal : 2000;
    const d = this.days[dateKey];
    return base + (d && d.ex ? (this.profile?.bonus || 0) : 0);
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
  },
};
