// runtime/universal-intake.ts

export type ABIRequest = {
  version: "1.0";
  kind: "call.request";
  ts: string;                 // ISO
  id?: string;                // passthrough si venía
  ctx?: any;                  // passthrough si venía
  payload: { op: string; input?: any };
};

export type ABIEventError = {
  version: "1.0";
  kind: "event.error";
  ts: string;
  payload: { error: { code: string; message: string; details?: any } };
};

const nowISO = () => new Date().toISOString();
const MAX_LINE_BYTES = Number(process.env.UTOPY_INTAKE_MAX || 2_000_000); // 2MB

function toReq(op: string, input?: any, id?: string, ctx?: any, ts?: string): ABIRequest {
  return {
    version: "1.0",
    kind: "call.request",
    ts: ts || nowISO(),
    id,
    ctx,
    payload: { op: String(op), input },
  };
}

function err(message: string, details?: any, code = "E_SCHEMA"): ABIEventError {
  return { version: "1.0", kind: "event.error", ts: nowISO(), payload: { error: { code, message, details } } };
}

// ---------------- parsers helpers ----------------

function safeTrimBOM(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

function tooBig(value: any): boolean {
  try {
    if (typeof value === "string") return value.length > MAX_LINE_BYTES;
    const s = JSON.stringify(value);
    return s.length > MAX_LINE_BYTES;
  } catch {
    return false;
  }
}

// URL-encoded: "op=ping&msg=hola"
function tryParseUrlEncoded(s: string): { [k: string]: string } | null {
  if (!s || !s.includes("=")) return null;
  try {
    const params = new URLSearchParams(s);
    let hasAny = false;
    const obj: Record<string, string> = {};
    params.forEach((v, k) => { hasAny = true; obj[k] = v; });
    return hasAny ? obj : null;
  } catch { return null; }
}

// CSV-lite: "op, ping" | "ping, {json}" | "ping, arg"
function tryParseCsvLite(s: string): string[] | null {
  if (!s.includes(",")) return null;
  const parts = s.split(",").map(x => x.trim());
  return parts.length ? parts : null;
}

// ---------------- core normalize ----------------

/**
 * Normaliza “cualquier cosa razonable” a ABI v1 call.request.
 * No hace I/O; no valida schemas downstream; maximiza tolerancia.
 */
export function normalizeAnyToABI(value: any): ABIRequest | ABIEventError {
  try {
    // Guardas básicas
    if (tooBig(value)) {
      return err("Entrada supera tamaño máximo permitido", { limit: MAX_LINE_BYTES }, "E_SIZE");
    }

    // 0) Strings: limpiar BOM
    if (typeof value === "string") value = safeTrimBOM(value);

    // 1) ABI v1 directo (passthrough con defaults)
    if (value && typeof value === "object" &&
        value.version === "1.0" &&
        value.kind === "call.request" &&
        value.payload?.op) {
      return toReq(
        String(value.payload.op),
        value.payload.input,
        value.id,
        value.ctx,
        value.ts
      );
    }

    // 2) Compat {call:"ping", input?}
    if (value && typeof value === "object" && typeof value.call === "string") {
      return toReq(value.call, value.input, value.id, value.ctx, value.ts);
    }

    // 3) Compat {call:{op,input}}
    if (value && typeof value === "object" &&
        value.call && typeof value.call === "object" &&
        typeof value.call.op === "string") {
      return toReq(value.call.op, value.call.input, value.id, value.ctx, value.ts);
    }

    // 4) Objeto directo {op, input?}
    if (value && typeof value === "object" && typeof value.op === "string") {
      return toReq(value.op, value.input, value.id, value.ctx, value.ts);
    }

    // 5) Alias comunes en objetos sin op
    if (value && typeof value === "object") {
      const aliases = ["operation", "method", "fn", "type", "action"];
      for (const k of aliases) {
        if (typeof value[k] === "string") {
          return toReq(value[k], value.input ?? value.data ?? value.args ?? value.payload, value.id, value.ctx, value.ts);
        }
      }
    }

    // 6) DatoVivo inline → interpretar
    //    Acepta {simbolo, payload?, meta?}
    if (value && typeof value === "object" && typeof value.simbolo === "string") {
      // Devolvemos op="interpretar" con input crudo; tu fromABIcallToEnvelope
      // ya envuelve en señal si falta.
      const input = { simbolo: value.simbolo, payload: value.payload, meta: value.meta };
      return toReq("interpretar", input, value.id, value.ctx, value.ts);
    }

    // 7) Array: ["op","ping",{...}] o ["ping",{...}]
    if (Array.isArray(value)) {
      if (value.length >= 2 && (value[0] === "op" || value[0] === "operation" || value[0] === "method" || value[0] === "fn")) {
        return toReq(String(value[1]), value[2]);
      }
      if (value.length >= 1) {
        return toReq(String(value[0]), value[1]);
      }
    }

    // 8) String
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return err("Línea vacía", { raw: value }, "E_EMPTY");

      // 8.a) URL-encoded
      const urlObj = tryParseUrlEncoded(s);
      if (urlObj) {
        const op = urlObj.op || urlObj.operation || urlObj.fn || urlObj.method || urlObj.call;
        const { op: _a, operation: _b, fn: _c, method: _d, call: _e, ...rest } = urlObj as any;
        if (op) {
          const input = Object.keys(rest).length ? rest : undefined;
          return toReq(String(op), input);
        }
      }

      // 8.b) CSV-lite
      const csv = tryParseCsvLite(s);
      if (csv) {
        if (csv[0] === "op" && csv[1]) {
          return toReq(String(csv[1]));
        }
        if (csv[0] && csv[1]) {
          const op = String(csv[0]);
          const tail = csv.slice(1).join(",");
          try {
            // intentar JSON en la segunda parte
            const maybeJson = JSON.parse(tail);
            return toReq(op, maybeJson);
          } catch {
            return toReq(op, { arg: csv[1] });
          }
        }
        if (csv[0]) return toReq(String(csv[0]));
      }

      // 8.c) Palabra sola → op
      if (/^[\w.:/-]+$/.test(s)) {
        return toReq(s);
      }

      // 8.d) JSON string tardío
      try {
        const j = JSON.parse(s);
        return normalizeAnyToABI(j);
      } catch {
        // Si no es JSON, lo tratamos como texto libre → interpretar
        return toReq("interpretar", { simbolo: "📝", payload: { raw: s } });
      }
    }

    // 9) Último intento: no reconocido
    return err("Mensaje no coincide con ninguna forma conocida", {
      sampleType: typeof value,
      hasVersion: !!value?.version,
      hasKind: !!value?.kind,
      hasPayloadOp: !!value?.payload?.op
    });
  } catch (e: any) {
    return err("Fallo del intake", { message: String(e?.message || e) }, "E_INTAKE");
  }
}
// ====================================================================
// U T O P Ý   S P O R E   —  H A N D L E R S   M Í N I M O S
// ====================================================================

/**
 * Suposiciones suaves sobre el runtime:
 *  - ctx.ack(data): responde event.ack (o equivalente)
 *  - ctx.err(msg,details?,code?): responde event.error (o equivalente)
 *  - ctx.emit(kind,payload): emite evento/broadcast/auditoría
 *  - ctx.forward(op,input): reinyecta la op normalizada al router
 *  - ctx.nodeId: id simbólico del nodo vivo
 *  - ctx.hostIp: IP del host (para armar deeplink ws://IP:8787)
 *  - ctx.store?: { put(id,obj), get(id), all():Promise<any[]> }
 *
 * Si store no existe, usamos un Map en memoria para arrancar.
 */

type Ctx = {
  ack: (data: any) => any | Promise<any>;
  err: (msg: string, details?: any, code?: string) => any | Promise<any>;
  emit: (kind: string, payload?: any) => void | Promise<void>;
  forward: (op: string, input?: any) => any | Promise<any>;
  nodeId?: string;
  hostIp?: string;
  store?: {
    put: (id: string, obj: any) => Promise<void> | void;
    get?: (id: string) => Promise<any> | any;
    all?: () => Promise<any[]> | any[];
  };
};

// ——— Diccionario simbólico vivo (en memoria para empezar) ———
const symbolDict: Record<string, { op: string; note?: string }> = {
  "🌱": { op: "dato.create", note: "semilla/dato vivo" },
  "🔎": { op: "dato.query",  note: "consulta" },
  "💬": { op: "interpretar.msg", note: "mensaje humano" },
  "📦": { op: "invocar.cap", note: "capability/worker" },
};

// ——— Store mínimo (RAM) si no hay ctx.store ———
const __memStore = new Map<string, any>();
async function storePut(ctx: Ctx, id: string, obj: any) {
  if (ctx.store?.put) return ctx.store.put(id, obj);
  __memStore.set(id, obj);
}
async function storeAll(ctx: Ctx): Promise<any[]> {
  if (ctx.store?.all) return await ctx.store.all();
  return Array.from(__memStore.values());
}

// ——— Tipo común de handler ———
type Handler = (msg: any, ctx: Ctx) => Promise<any>;

// Si tu archivo ya exporta/declara `handlers`, usalo.
// Si no existe, descomentá la siguiente línea:
// const handlers: Record<string, Handler> = (globalThis as any).__utopyHandlers ||= {};

// 1) spore.hello — handshake de espora
const hSporeHello: Handler = async (_msg, ctx) => {
  return ctx.ack({
    kind: "event.welcome",
    node: { id: ctx.nodeId || "node", ts: new Date().toISOString() },
    dict: symbolDict,
  });
};

// 2) sem.tell — enseñar símbolo nuevo (emoji → op)
const hSemTell: Handler = async (msg, ctx) => {
  const { simbolo, op, note } = msg?.payload?.input || {};
  if (!simbolo || !op) return ctx.err("sem.tell requiere {simbolo, op}");
  symbolDict[simbolo] = { op, note };
  // TODO(opcional): persistir en disco (JSONL) si querés
  return ctx.ack({ kind: "event.sem.learned", simbolo, op, note });
};

// 3) interpretar — fallback simbólico
const hInterpretar: Handler = async (msg, ctx) => {
  const { simbolo, payload } = msg?.payload?.input || {};
  if (!simbolo) return ctx.err("interpretar requiere {simbolo}");
  const map = symbolDict[simbolo];
  if (map?.op) {
    // Redirige a la operación aprendida
    return ctx.forward(map.op, payload);
  }
  // Si no hay significado local, emitimos resonancia (para aprendizaje)
  await ctx.emit("event.resonancia", { simbolo, payload, via: "fallback" });
  return ctx.ack({ kind: "event.interpretar.fallback" });
};

// 4) dato.create — mínimo funcional (usa memoria si no hay store)
const hDatoCreate: Handler = async (msg, ctx) => {
  const { id, type, attrs } = msg?.payload?.input || {};
  if (!id || !type) return ctx.err("dato.create requiere {id, type}");
  const dv = { id, type, attrs: attrs || {}, ts: new Date().toISOString() };
  await storePut(ctx, id, dv);
  await ctx.emit("event.dato.created", { id, type });
  return ctx.ack({ ok: true, id, type });
};

// 5) dato.query — mínimo (filtro simple por where en raíz o attrs)
const hDatoQuery: Handler = async (msg, ctx) => {
  const { where, limit = 20 } = msg?.payload?.input || {};
  const all = await storeAll(ctx);
  const filtered = all.filter((dv: any) => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => dv[k] === v || dv?.attrs?.[k] === v);
  }).slice(0, limit);
  return ctx.ack({ items: filtered, count: filtered.length });
};

// 6) seed.invite — generar deep link para nacer nuevas esporas
const hSeedInvite: Handler = async (msg, ctx) => {
  const prefer = msg?.payload?.input?.prefer || "ws";
  // Mejor esfuerzo para IP; si no hay, cae a localhost
  const ip = ctx.hostIp || "localhost";
  const ws = `ws://${ip}:8787`;
  const nodeId = ctx.nodeId || "node";
  const manifest = { id: nodeId, ws, prefer };
  const deeplink =
    `utopy://attach?ws=${encodeURIComponent(ws)}&id=${encodeURIComponent(nodeId)}&prefer=${encodeURIComponent(prefer)}`;
  return ctx.ack({ kind: "seed.invite", manifest, deeplink });
};

// —— Registro ——
// Si ya tenés un objeto `handlers`, mergeamos.
// Si no, exportamos un helper para que lo invoques donde agrupás handlers.
const __sporeHandlers: Record<string, Handler> = {
  "spore.hello": hSporeHello,
  "sem.tell": hSemTell,
  "interpretar": hInterpretar,
  "dato.create": hDatoCreate,
  "dato.query": hDatoQuery,
  "seed.invite": hSeedInvite,
};

// Intenta asignar si existe `handlers` global/local
try {
  // @ts-ignore
  if (typeof handlers === "object" && handlers) Object.assign(handlers, __sporeHandlers);
} catch { /* si no existe, no pasa nada */ }

// Export para registro manual si lo preferís en otro módulo:
export function registerSporeHandlers(target: Record<string, Handler>) {
  Object.assign(target, __sporeHandlers);
}
