// Offline support: the page itself is network-first (so updates arrive), images and fonts are cache-first.
const V = "slk320-c288a38ac6";
const CORE = ["./", "index.html", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("slk320-") && k !== V && k !== "slk320-img").map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (r.mode === "navigate" || u.pathname.endsWith("/index.html")) {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put("index.html", cp)); return res; }).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).then(res => {
    if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(u.pathname.includes("/img/") ? "slk320-img" : V).then(c => c.put(r, cp)); }
    return res; })));
});
