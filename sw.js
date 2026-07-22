/* Decks — service worker */
const VERSION = "decks-v2";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Decks (cartes/*) : réseau d'abord, cache en secours — mise à jour au fil de l'eau
  if (url.origin === location.origin && url.pathname.includes("/cartes/")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Polices Google : cache d'abord (hors-ligne durable)
  if (url.hostname.includes("fonts.googleapis.com") || url.hostname.includes("fonts.gstatic.com")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Coquille de l'app : cache d'abord, réseau en secours
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match("./index.html")))
    );
  }
});
