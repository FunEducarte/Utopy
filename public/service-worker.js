const CACHE_NAME = "utopy-cache-v1";
const FILES_TO_CACHE = [
  "./index.html",
  "./resonador.embed.js",
  "./wasm-build/resonador_wasm_bg.wasm",
  "./wasm-build/resonador_wasm.js",
  "./manifest.webmanifest",
  "./u.png",
];

self.addEventListener("install", (event) => {
  console.log("🔹 Instalando Service Worker simbiótico...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("🔹 Activando Service Worker simbiótico...");
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
