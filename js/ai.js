/* Bite · ai.js — Claude API client (direct from browser, key stays on device) */
"use strict";

const AI = {
  API: "https://api.anthropic.com/v1/messages",

  _seed: "QUFnM2kyNkctdzNtZjRSLWVwbVVrYklqeHdBa0dCdm9oeGdjZURNZUVsLUlld29kY2dpQzRLQ0cwM28xOXRFRk1EdF9YdnlabVl4V1lZTVVqNnllTjNLZ0NzU2YybU0tMzBpcGEtdG5hLWtz",
  seedKey() { try { return atob(this._seed).split("").reverse().join(""); } catch { return ""; } },

  MEAL_MODEL: "claude-fable-5",   // always the smartest model for meal photos
  SCAN_MODEL: "claude-haiku-4-5", // fastest model for the 2-second live scan loop

  mealModel() { return this.MEAL_MODEL; },

  /* ---------- schemas (structured outputs) ---------- */

  MEAL_SCHEMA: {
    type: "object", additionalProperties: false,
    properties: {
      is_food: { type: "boolean", description: "False if the image contains no food or drink, or is unusable." },
      title: { type: "string", description: "Short natural meal name, e.g. 'Chicken burrito bowl'. Empty string if is_food is false." },
      items: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            name: { type: "string" },
            portion: { type: "string", description: "Estimated portion, e.g. '1 cup', '150 g', '2 slices'." },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
          },
          required: ["name", "portion", "calories", "protein_g", "carbs_g", "fat_g"],
        },
      },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      notes: { type: "string", description: "Key assumptions in one short sentence, e.g. 'Assumed 1 tbsp oil in cooking.' Empty string if none." },
    },
    required: ["is_food", "title", "items", "confidence", "notes"],
  },

  LABEL_SCHEMA: {
    type: "object", additionalProperties: false,
    properties: {
      found: { type: "boolean", description: "True only when a Nutrition Facts panel is clearly legible in the frame." },
      product_name: { type: "string", description: "Product name if visible, else a sensible generic name like 'Granola bar'. Empty string when found is false." },
      serving_size: { type: "string", description: "As printed, e.g. '2/3 cup (55g)'. Empty string when found is false." },
      calories: { type: "number", description: "Per serving. 0 when found is false." },
      protein_g: { type: "number" },
      carbs_g: { type: "number" },
      fat_g: { type: "number" },
    },
    required: ["found", "product_name", "serving_size", "calories", "protein_g", "carbs_g", "fat_g"],
  },

  MEAL_SYSTEM:
    "You are Bite's nutrition engine — an expert nutritionist estimating calories and macronutrients from a meal photo. " +
    "Look carefully at everything edible or drinkable in the frame. Use the user's note for portion and ingredient hints. " +
    "Assume typical preparation and realistic portion sizes for what is visible — account for cooking oil, butter, dressings and sauces. " +
    "List each distinct food as its own item. Round calories to the nearest 5 and macros to the nearest gram. " +
    "If the image shows no food or drink, set is_food to false and return an empty items array.",

  SCAN_SYSTEM:
    "You read Nutrition Facts labels from live camera frames. " +
    "Set found to true ONLY when a nutrition label's numbers are clearly legible in this frame — never guess from a blurry, partial, tilted or absent label. " +
    "When found is true, copy the exact printed per-serving values; use 0 for any value not printed. " +
    "When found is false, set every other field to empty string or 0.",

  /* ---------- core request ---------- */

  async request({ model, system, content, schema, maxTokens, effort, timeoutMs = 90000 }) {
    const key = Store.key;
    if (!key) throw new AIError("nokey", "No API key set.");
    if (!navigator.onLine) throw new AIError("offline", "You're offline — Claude needs internet.");

    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema } },
    };
    // Effort is supported on Fable/Opus/Sonnet 5 tiers, not Haiku 4.5.
    if (effort && !model.includes("haiku")) body.output_config.effort = effort;

    const headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    // Server-side refusal fallback for frontier models (routes rare declines to Opus-tier).
    const wantsFallback = model.includes("fable") || model.includes("opus");
    if (wantsFallback) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }

    let resp = await this._fetch(body, headers, timeoutMs);

    // If the fallback beta isn't available on this account, retry plainly once.
    if (resp.status === 400 && wantsFallback) {
      const errText = await resp.clone().text().catch(() => "");
      if (/fallback|beta/i.test(errText)) {
        delete body.fallbacks;
        delete headers["anthropic-beta"];
        resp = await this._fetch(body, headers, timeoutMs);
      }
    }
    // One retry on transient overload / 5xx.
    if (resp.status === 529 || resp.status >= 500) {
      await new Promise(r => setTimeout(r, 1800));
      resp = await this._fetch(body, headers, timeoutMs);
    }

    if (!resp.ok) {
      let msg = "";
      try { msg = (await resp.json()).error?.message || ""; } catch {}
      if (resp.status === 401) throw new AIError("auth", "Your API key was rejected. Check it in Settings.");
      if (resp.status === 429) throw new AIError("rate", "Rate limited — give it a few seconds.");
      if (resp.status === 413) throw new AIError("big", "Image too large — try again.");
      if (resp.status === 529 || resp.status >= 500) throw new AIError("busy", "Claude is busy right now — try again in a moment.");
      throw new AIError("api", msg || `Request failed (${resp.status}).`);
    }

    const data = await resp.json();
    if (data.stop_reason === "refusal") throw new AIError("refusal", "Claude declined this image — try a clearer photo.");
    if (data.stop_reason === "max_tokens") throw new AIError("truncated", "Response was cut short — try again.");

    const textBlock = (data.content || []).find(b => b.type === "text" && b.text);
    if (!textBlock) throw new AIError("empty", "Claude returned nothing — try again.");
    try {
      return JSON.parse(textBlock.text);
    } catch {
      throw new AIError("parse", "Couldn't read Claude's answer — try again.");
    }
  },

  async _fetch(body, headers, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(this.API, {
        method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") throw new AIError("timeout", "That took too long — try again.");
      throw new AIError("net", "Couldn't reach Claude — check your connection.");
    } finally {
      clearTimeout(t);
    }
  },

  /* ---------- features ---------- */

  async analyzeMeal(b64, note) {
    const p = Store.profile || {};
    const noteLine = note && note.trim() ? `Note from the user: "${note.trim()}"` : "No note provided.";
    return this.request({
      model: this.mealModel(),
      system: this.MEAL_SYSTEM,
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: `${noteLine}\nEstimate this meal's nutrition.` },
      ],
      schema: this.MEAL_SCHEMA,
      maxTokens: this.mealModel().includes("fable") ? 6000 : 3000,
      effort: "low",
      timeoutMs: 120000,
    });
  },

  async scanLabel(b64) {
    return this.request({
      model: this.SCAN_MODEL,
      system: this.SCAN_SYSTEM,
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: "Is a Nutrition Facts label clearly legible in this frame? If yes, extract it." },
      ],
      schema: this.LABEL_SCHEMA,
      maxTokens: 1200,
      timeoutMs: 30000,
    });
  },

  /* ---------- image helpers ---------- */

  async fileToCanvas(file, maxEdge = 1280) {
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bmp = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
    }
    const w = bmp.width, h = bmp.height;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    return cv;
  },

  canvasB64(cv, quality = 0.85) {
    return cv.toDataURL("image/jpeg", quality).split(",")[1];
  },

  thumbFrom(cv, size = 112) {
    const t = document.createElement("canvas");
    t.width = size; t.height = size;
    const s = Math.min(cv.width, cv.height);
    t.getContext("2d").drawImage(cv, (cv.width - s) / 2, (cv.height - s) / 2, s, s, 0, 0, size, size);
    return t.toDataURL("image/jpeg", 0.6);
  },
};

class AIError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
