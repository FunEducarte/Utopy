self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// Broadcast helper
async function broadcast(type, payload) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const c of clients) {
    c.postMessage({ type, payload });
  }
}

self.addEventListener("fetch", event => {
  const req = event.request;
  const ct = req.headers.get("content-type") || "";
  if (req.method === "POST" && ct.includes("application/x.datovivo+jsonl")) {
    event.respondWith((async () => {
      const text = await req.text();
      // dividir por líneas → cada línea es un DatoVivo
      for (const line of text.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try {
          const obj = JSON.parse(s);
          // puede ser DatoVivo o Resonancia
          if (obj.simbolo) await broadcast("dv:in", obj);
          else if (obj.tipo) await broadcast("dv:res", obj);
        } catch {}
      }
      return new Response(null, { status: 204 });
    })());
  }
});
