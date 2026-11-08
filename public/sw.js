/* PayFlow service worker. Caches only static assets; never caches pages with personal data or API/server-action responses. */
const STATIC = "payflow-static-v1";
const SHELL = ["/offline.html", "/icons/192.png", "/icons/512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Hashed build assets and icons never change for a given URL: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Page navigations go to the network; if it is unreachable show the offline page.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});

// Tell open pages to sync queued punches when the browser regains connectivity (where supported).
self.addEventListener("sync", (e) => {
  if (e.tag === "payflow-punches") {
    e.waitUntil(
      self.clients
        .matchAll({ type: "window" })
        .then((cs) => cs.forEach((c) => c.postMessage({ type: "sync-punches" }))),
    );
  }
});
