import { NodeMind } from "../../src/core/mind/NodeMind";
import type { DatoVivo, Resonancia } from "../../src/core/types/core";

export async function bootDvClient() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
  }
  const mind = new NodeMind({ nombre: "Nodo (SW-bridge)" });
  navigator.serviceWorker.addEventListener("message", async (evt:any) => {
    const { type, payload } = evt.data || {};
    if (type === "dv:in" && payload?.simbolo) {
      const res = await mind.interpretarDato(payload as DatoVivo, { origen:"sw" });
      // opcional: devolver resonancias al SW (para otros clientes)
      if (navigator.serviceWorker.controller) {
        for (const r of res) navigator.serviceWorker.controller.postMessage({ type:"dv:res", payload:r });
      }
      // notificar a tu UI local
      window.dispatchEvent(new CustomEvent("dv:res", { detail: res as Resonancia[] }));
    }
    if (type === "dv:res") {
      window.dispatchEvent(new CustomEvent("dv:res", { detail: [payload as Resonancia] }));
    }
  });
  return mind;
}
