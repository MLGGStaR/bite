/* Bite · service worker — app-shell caching for offline/instant loads */
"use strict";

const VERSION = "bite-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/store.js",
  "./js/ai.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const IS_DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);

self.addEventListener("install", e => {
  if (IS_DEV) { self.skipWaiting(); return; }
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (IS_DEV) return;                          // passthrough while developing
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;  // never touch the Claude API

  // Navigations: network first, cached shell as fallback.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put("./index.html", cp)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: cache first, refresh in the background.
  e.respondWith(
    caches.match(e.request).then(hit => {
      const refresh = fetch(e.request)
        .then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return r; })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
