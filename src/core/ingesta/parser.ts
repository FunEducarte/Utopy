// Parser ADN (cara poética) → Datos Vivos (cara interoperable)
// y Serializer inverso. No requiere tipos ADN antiguos.

import type { DatoVivo } from "../types/core";

// ---------- Helpers ----------
function clean(s: string) { return s.trim().replace(/[,;]$/, ""); }

// Elimina VS16 y espacios raros, y colapsa múltiples espacios
function normalizeEmoji(s: string) {
  return s.replace(/\uFE0F/g, "").replace(/\s+/g, " ").trim();
}

function parseValue(v: string): any {
  const t = v.trim();

  // booleanos
  if (t === "true") return true;
  if (t === "false") return false;

  // números (admite +, -, decimales, notación simple)
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);

  // JSON explícito
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch { /* cae a string */ }
  }

  // entre comillas
  const m = t.match(/^"(.*)"$/) || t.match(/^'(.*)'$/);
  if (m) return m[1];

  // unidades/símbolos (°C, %, etc) → string tal cual
  return t;
}

function parseKVBody(body: string): Record<string, any> {
  // Soporta: a=1, b = "x", unidad = °C, lista = [1,2], obj = {a:1}
  // Se asume que si había JSON complejo, ya se parseó antes en el try-catch principal.
  const out: Record<string, any> = {};
  const parts = body
    // separa por comas / punto y coma / saltos fuera de pares de comillas
    .split(/(?<!\\)[,;\n]/g)
    .map(s => s.trim())
    .filter(Boolean);

  for (const p of parts) {
    // divide en la primera aparición de ':' o '=' para no romper valores con ':'
    const m = p.match(/^([^:=]+)\s*[:=]\s*([\s\S]+)$/);
    if (!m) continue;
    const key = clean(m[1]);
    const val = clean(m[2]);
    out[key] = parseValue(val);
  }
  return out;
}

// ---------- Parser principal ----------
/**
 * Acepta líneas tipo:
 *   🌡️ sensor.temp { c = 32, unidad = °C, lote = A1 }
 *   🧩 capability { id="ts.sensor.temp", claims=["sensor://temp"], runtime="ts", entry="local:ts.sensor.temp" }
 *   🧬 adn { nombre="Nodo X", rol="productor" }
 *   📄 contrato { firmante="Ana" }
 *   🎥 video { fps=30, latMs=120 }
 */
export function parseADNToDatosVivos(texto: string): DatoVivo[] {
  const lines = texto
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length && !l.startsWith("#"));

  const datos: DatoVivo[] = [];
  for (const line of lines) {
    // 1) emoji + (opcional token) + { cuerpo }
    // tolerante: Emoji_Presentation | Extended_Pictographic | Emoji
    const m = line.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*([^\{\s]+)?\s*(\{[\s\S]*\})?$/u);
    if (!m) {
      // si no tiene emoji, lo guardamos como texto libre simbólico
      datos.push({ simbolo: "📝", payload: { text: line } });
      continue;
    }
    let simbolo = normalizeEmoji(m[1]);       // normaliza VS16/espacios
    const token   = (m[2] || "").trim();      // ej: sensor.temp, contrato, capability
    const bodyRaw = (m[3] || "").trim();

    let payload: any = {};
    if (bodyRaw) {
      // intento JSON directo; si falla, parseo KV tolerante
      try { payload = JSON.parse(bodyRaw); }
      catch {
        const body = bodyRaw.replace(/^\{|\}$/g, "");
        payload = parseKVBody(body);
      }
    }

    // normalización mínima de alias comunes:
    if (simbolo === "🧬" && token === "adn") {
      datos.push({ simbolo: "🧬", payload });
      continue;
    }
    if (simbolo === "🧩" && token === "capability") {
      datos.push({ simbolo: "🧩 capability", payload });
      continue;
    }
    if (simbolo === "🧩" && token === "perform") {
      datos.push({ simbolo: "🧩 perform", payload });
      continue;
    }

    // genérico: simbolo con payload
    datos.push({ simbolo, payload: token ? { token, ...payload } : payload });
  }
  return datos;
}

// ---------- Serializer inverso ----------
/** Convierte un DatoVivo a una línea ADN legible */
export function datoVivoToADNLine(d: DatoVivo): string {
  const pretty = (o: any) => {
    if (!o || typeof o !== "object") return String(o ?? "");
    const entries = Object.entries(o).map(([k,v]) => {
      if (typeof v === "string" && !/^[\w.:%°°C°F+\-]+$/.test(v)) {
        // escapá comillas internas
        const esc = v.replace(/"/g, '\\"');
        return `${k} = "${esc}"`;
      }
      if (typeof v === "object") return `${k} = ${JSON.stringify(v)}`;
      return `${k} = ${String(v)}`;
    });
    return `{ ${entries.join(", ")} }`;
  };

  if (d.simbolo === "🧩 capability") return `🧩 capability ${pretty(d.payload)}`;
  if (d.simbolo === "🧩 perform")    return `🧩 perform ${pretty(d.payload)}`;
  if (d.simbolo === "🧬")            return `🧬 adn ${pretty(d.payload)}`;
  return `${d.simbolo} ${pretty(d.payload ?? {})}`;
}
