self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());

// Canal opcional para broadcast
const bc = new BroadcastChannel("datovivo");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith((async () => {
    const res = await fetch(req);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/x.datovivo+jsonl")) {
      (async () => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream:true });
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx+1);
            if (!line) continue;
            try {
              const dv = JSON.parse(line); // DatoVivo
              // Re-emite a todas las páginas
              bc.postMessage({ kind:"dv", dv });
              const clients = await self.clients.matchAll({ includeUncontrolled:true });
              clients.forEach(c => c.postMessage({ kind:"dv", dv }));
            } catch (e) {
              // opcional: avisar error
              bc.postMessage({ kind:"error", error:"bad-jsonl" });
            }
          }
        }
      })();
      // Devolvemos un 204 "consumido por SW" (la página no necesita el body)
      return new Response(null, { status:204, statusText:"Datovivo Consumed" });
    }
    return res; // no es datovivo → sigue normal
  })());
});
