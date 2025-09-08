// src/nodo/tipos.ts

// Un entorno puede ser cualquier etiqueta, un patrón o una función de predicado.
export type Entorno = string | RegExp | ((env: string) => boolean);

// Capacidades libres con convención tipo URI (sensor://qr, exec://py, …)
export type Cap = string;

export function normalizeCap(cap: Cap): string {
  return cap.trim().toLowerCase();
}

export function capParts(cap: Cap) {
  const c = normalizeCap(cap);
  const [scheme, rest = ""] = c.split("://");
  const [path, query = ""] = rest.split("?");
  const pathSeg = path.split("/").filter(Boolean);
  return { scheme, path, pathSeg, query };
}

/** Coincidencia jerárquica simple:
 *  - exacta:   exec://py  ≈ exec://py
 *  - prefijo:  exec://    ≈ exec://py
 *  - rama:     connect://evm ≈ connect://evm/sepolia
 */
export function claimMatches(target: Cap, offered: Cap): number {
  const t = capParts(target);
  const o = capParts(offered);
  if (t.scheme !== o.scheme) return 0;

  // target sin path → “cualquier” de ese scheme
  if (t.pathSeg.length === 0) return 0.6;

  let i = 0;
  while (i < t.pathSeg.length && i < o.pathSeg.length && t.pathSeg[i] === o.pathSeg[i]) i++;
  const shared = i;
  if (shared === 0) return 0;

  const depthBias = 0.2 * Math.min(shared, 3); // 0..0.6
  const exactBonus =
    t.pathSeg.length === o.pathSeg.length && shared === t.pathSeg.length ? 0.25 : 0;
  return Math.min(1, 0.2 + depthBias + exactBonus);
}

/** Evaluación múltiple de claims: devuelve el score medio */
export function multiClaimMatches(targets: Cap[], offered: Cap[]): number {
  if (!targets.length || !offered.length) return 0;
  const scores: number[] = [];
  for (const t of targets) {
    for (const o of offered) {
      const s = claimMatches(t, o);
      if (s > 0) scores.push(s);
    }
  }
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ---------- Señales / Contexto ----------
export interface Señal {
  tipo: "archivo" | "qr" | "gesto" | "audio" | "red" | "texto" | "evento" | "sensor";
  origen: string;
  payload: any;
  meta?: Record<string, any>;
}

export interface ResonanciaContext {
  entorno: string;
  emitir(señal: Señal): void;
  permisos?: string[];
}

// ---------- Tipos de resonador / runner ----------
export type Resonador = {
  id: string;
  tipo: "lenguaje" | "intencion";
  lenguaje: string;
  descripcion: string;
  extension?: string;

  entornos?: Entorno[];
  caps?: Cap[];

  iniciar?: (ctx: { entorno: string; emitir: (s: Señal) => void; permisos?: string[] }) => Promise<void>;
  detener?: () => Promise<void>;
  generar?: () => string;

  perform?: (req: { claim: Cap; params?: any }) => Promise<any>;
};

export interface Runner {
  id: string;
  lenguaje: string;
  entornos: Entorno[];
  puedeEjecutar(art: { ext?: string; mime?: string; lenguaje?: string }): boolean;
  ejecutar(art: { codigo?: string; path?: string; args?: any }): Promise<any>;
}

// ---------- Matching de entornos ----------
export function entornoActual(): string {
  const tags: string[] = [];
  if (typeof window !== "undefined" && typeof document !== "undefined") tags.push("web");
  if (typeof process !== "undefined" && (process as any).versions?.node) tags.push("node");
  if ((globalThis as any).__UTOPY_WASM__) tags.push("wasm");
  return tags.join("+") || "unknown";
}

export function matchesEntorno(entornos: Entorno[] | undefined, actual: string): boolean {
  if (!entornos || entornos.length === 0) return true;
  const tokens = new Set(actual.toLowerCase().split("+").filter(Boolean));

  return entornos.some((e) => {
    if (typeof e === "string") {
      const val = e.toLowerCase();
      if (val === "*" || val === "any") return true;
      return tokens.has(val);
    }
    if (e instanceof RegExp) {
      return e.test(actual);
    }
    if (typeof e === "function") {
      try { return !!e(actual); } catch { return false; }
    }
    return false;
  });
}
