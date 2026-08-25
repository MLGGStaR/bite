/* Bite · service worker — network-first so deployed changes show up automatically;
   the cache is only a fallback for offline launches. */
"use strict";

const VERSION = "bite-v3";
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
  if (IS_DEV) return;                               // passthrough while developing
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;  // never touch the Claude API

  // Always try the network first (bypassing HTTP cache) so every launch gets
  // the newest deploy; fall back to the cached copy when offline.
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then(r => {
        if (r.ok) {
          const cp = r.clone();
          caches.open(VERSION).then(c => c.put(e.request, cp));
        }
        return r;
      })
      .catch(() =>
        caches.match(e.request).then(hit =>
          hit || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())
        )
      )
  );
});
