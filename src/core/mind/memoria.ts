import fs from "node:fs";
import path from "node:path";

export type Significado = {
  clase?: string;
  unidad?: string;   // ej: "celsius", "fahrenheit", "kPa", etc.
  path?: string;     // ej: "sensor.temp"
  conf?: number;     // 0..1
  fuente?: string;   // ej: "nodo://demo"
  t?: string;        // ISO
};

export type Memoria = {
  diccionario: Record<string, Significado[]>;
  capabilities: Record<string, any[]>;
};

const FILE = path.resolve("state/memoria.json");

export function cargarMemoria(): Memoria {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { diccionario: {}, capabilities: {} };
  }
}

export function guardarMemoria(m: Memoria) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(m, null, 2));
}

export function significadoTop(m: Memoria, simbolo: string): Significado | null {
  const arr = m.diccionario[simbolo];
  if (!arr || !arr.length) return null;
  return arr.slice().sort((a, b) => (b.conf || 0) - (a.conf || 0))[0];
}

export function mergeSignificado(m: Memoria, simbolo: string, s: Significado) {
  const arr = m.diccionario[simbolo] || [];
  const idx = arr.findIndex(x => x.fuente === s.fuente);
  if (idx >= 0) {
    const prev = arr[idx];
    const conf = Math.min(1, ((prev.conf || 0) + (s.conf || 0)) / 2);
    arr[idx] = { ...prev, ...s, conf, t: new Date().toISOString() };
  } else {
    arr.push({ ...s, t: new Date().toISOString() });
  }
  m.diccionario[simbolo] = arr;
}

/**
 * Normaliza un DatoVivo "sueltito" según un Significado aprendido.
 * Ejemplo: unidad=celsius y payload.raw="31" -> payload={c:31}
 */
export function normalizarSegunSignificado(
  simbolo: string,
  payload: any,
  sig: Significado | null
): any {
  if (!sig) return payload;

  // Heurística mínima: si trae "raw" con número y la unidad es conocida, lo estructura.
  const raw = payload?.raw;
  const n = typeof raw === "string" ? Number(raw) : (typeof raw === "number" ? raw : NaN);

  if (!Number.isNaN(n)) {
    if (sig.unidad?.toLowerCase() === "celsius") {
      return { c: n };
    }
    if (sig.unidad?.toLowerCase() === "fahrenheit") {
      return { f: n };
    }
  }

  // Si no pudimos, devolvemos tal cual.
  return payload;
}
