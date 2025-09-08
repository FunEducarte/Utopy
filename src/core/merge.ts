import type { DatoVivo } from "./types/core";

export type TrustPolicy = {
  autoMerge: boolean;
  manualReview?: boolean;
  trustedIds?: string[]; // ids de nodo/firmas permitidas (si usas seguridad.meta)
};

export type NodoState = {
  identidad?: Record<string, any>; // de 🧬
  capabilities: Record<string, { id:string; claims:string[]; runtime?:string; entry?:string; meta?:any }>;
  log: DatoVivo[];                 // eventos/mediciones/contratos (append)
};

export function emptyState(): NodoState {
  return { capabilities: {}, log: [] };
}

/** combiner profundo simple para identidad */
function deepMerge(a: any, b: any) {
  if (Array.isArray(a) && Array.isArray(b)) return Array.from(new Set([...a, ...b]));
  if (a && typeof a === "object" && b && typeof b === "object") {
    const out: any = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b ?? a;
}

/** JSON stringify estable (ordena claves) para claves de dedupe */
function stableStringify(obj: any): string {
  const seen = new WeakSet();
  const sorter = (x: any): any => {
    if (!x || typeof x !== "object") return x;
    if (seen.has(x)) return null;
    seen.add(x);
    if (Array.isArray(x)) return x.map(sorter);
    const keys = Object.keys(x).sort();
    const out: any = {};
    for (const k of keys) out[k] = sorter(x[k]);
    return out;
  };
  return JSON.stringify(sorter(obj));
}

/** reconciliación de un DatoVivo contra el estado local */
export function reconcileDato(state: NodoState, incoming: DatoVivo, policy: TrustPolicy): NodoState {
  // (opcional) chequeos de confianza por firma/peer
  const issuer = (incoming as any)?.seguridad?.issuer;
  if (policy.trustedIds && issuer && !policy.trustedIds.includes(String(issuer))) {
    return state; // ignorar o enrutar a revisión
  }

  const next: NodoState = { ...state, capabilities: { ...state.capabilities }, log: state.log.slice() };

  switch (incoming.simbolo) {
    case "🧬":
    case "🧬 adn": {
      next.identidad = deepMerge(next.identidad || {}, incoming.payload || {});
      return next;
    }
    case "🧩 capability": {
      const cap = incoming.payload || {};
      const id  = String(cap.id || "");
      if (!id) return next;
      next.capabilities[id] = {
        id,
        claims: Array.isArray(cap.claims) ? cap.claims.map(String) : [],
        runtime: cap.runtime ? String(cap.runtime) : undefined,
        entry: cap.entry ? String(cap.entry) : undefined,
        meta: incoming.meta
      };
      return next;
    }
    default: {
      // eventos/mediciones/contratos/etc → append-only con dedupe estable
      const key = stableStringify({ s: incoming.simbolo, p: incoming.payload, m: incoming.meta });
      const exists = next.log.some(d => stableStringify({ s: d.simbolo, p: d.payload, m: d.meta }) === key);
      if (!exists) next.log.push(incoming);
      return next;
    }
  }
}

/** fusiona arrays de DatoVivo (ej: histórico remoto con local) → nuevo estado */
export function reconcileMany(base: NodoState, incoming: DatoVivo[], policy: TrustPolicy): NodoState {
  return incoming.reduce((acc, d) => reconcileDato(acc, d, policy), base);
}
