#!/usr/bin/env tsx
import readline from "node:readline";
import { NodeMind } from "../src/core/mind/NodeMind";
import type { DatoVivo } from "../src/core/types/core";
import { bootstrapEspora } from "../src/espora/auto/bootstrap";
import {
  cargarMemoria,
  guardarMemoria,
  mergeSignificado,
  significadoTop,
  normalizarSegunSignificado,
} from "../src/core/mind/memoria";

import Ajv from "ajv";
import addFormats from "ajv-formats";

// 🔎 Schemas (draft-07). Requiere tsconfig {"resolveJsonModule": true}
import envelopeSchema from "../schemas/abi/v1/envelope.json";
import callAprenderSchema from "../schemas/abi/v1/call.aprender.json";
import callRegistrarSchema from "../schemas/abi/v1/call.registrar_cap.json";
import callInterpretarSchema from "../schemas/abi/v1/call.interpretar.json";
import evAckSchema from "../schemas/abi/v1/event.ack.json";
import evResSchema from "../schemas/abi/v1/event.resonancia.json";
import evErrSchema from "../schemas/abi/v1/event.error.json";
import sysCapSchema from "../schemas/abi/v1/sys.capability.json";
import semAskSchema from "../schemas/abi/v1/sem.ask.json";
import semTellSchema from "../schemas/abi/v1/sem.tell.json";
import capAskSchema from "../schemas/abi/v1/cap.ask.json";
import capTellSchema from "../schemas/abi/v1/cap.tell.json";

// 🧠 Universal Intake (tolerante)
import { normalizeAnyToABI } from "./universal-intake";
// --- DatoVivo store mínimo en RAM (si no tenés ctx.store para DVs) ---
const DV_MEM = new Map<string, any>();

async function dvPut(dv: any) {
  DV_MEM.set(dv.id, dv);
}

async function dvAll(): Promise<any[]> {
  return Array.from(DV_MEM.values());
}

console.error(
  "🔁 NodeMind boot: universal-intake ON",
  new Date().toISOString()
);

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

// Compiladores
const validators = {
  envelope: ajv.compile(envelopeSchema as any),
  "call.aprender": ajv.compile(callAprenderSchema as any),
  "call.registrar_cap": ajv.compile(callRegistrarSchema as any),
  "call.interpretar": ajv.compile(callInterpretarSchema as any),
  "event.ack": ajv.compile(evAckSchema as any),
  "event.resonancia": ajv.compile(evResSchema as any),
  "event.error": ajv.compile(evErrSchema as any),
  "sys.capability": ajv.compile(sysCapSchema as any),
  "sem.ask": ajv.compile(semAskSchema as any),
  "sem.tell": ajv.compile(semTellSchema as any),
  "cap.ask": ajv.compile(capAskSchema as any),
  "cap.tell": ajv.compile(capTellSchema as any),
};

const KNOWN_CALLS = new Set([
  "call.ping",
  "call.aprender",
  "call.registrar_cap",
  "call.interpretar",
]);
// ——— DV-capabilities index ———
type Capability = {
  id: string;
  kind: string;
  claims?: string[];
  conf?: number;
  meta?: Record<string, any>;
};

const CAP_INDEX = new Map<string, Capability>(); // por id

function upsertCapabilities(list: Capability[] = []) {
  for (const c of list) {
    if (!c?.id || !c?.kind) continue;
    CAP_INDEX.set(c.id, {
      id: c.id,
      kind: c.kind,
      claims: Array.isArray(c.claims) ? c.claims : [],
      conf: typeof c.conf === "number" ? c.conf : 0.5,
      meta: c.meta && typeof c.meta === "object" ? c.meta : {},
    });
  }
}

function findCapabilities(filtro?: string[]): Capability[] {
  const toks = (Array.isArray(filtro) ? filtro : []).map((s) =>
    String(s).toLowerCase()
  );
  const all = [...CAP_INDEX.values()];
  if (!toks.length) return all;
  return all.filter((c) => {
    const hay = new Set<string>([
      c.id.toLowerCase(),
      c.kind.toLowerCase(),
      ...(c.claims || []).map((x) => x.toLowerCase()),
    ]);
    return toks.some((t) => [...hay].some((x) => x.includes(t)));
  });
}

// Enviar un "call.request" dirigido a una capability (usando el claim como op)
function emitToCapability(
  cap: Capability,
  claim: string,
  input: any,
  ref?: string
) {
  w({
    version: "1.0",
    ref,
    kind: "call.request",
    ts: nowISO(),
    payload: { op: claim, input },
    ctx: { target_cap: cap.id, capability_kind: cap.kind },
  });
}

// ✅ Fuerza a que call.interpretar cumpla el schema (señal bien formada)
//    y sube ctx al envelope (por si el schema no permite ctx en payload)
function coerceCallInterpretar(env: Envelope): Envelope {
  if (env.kind !== "call.interpretar") return env;

  const p = (env.payload ?? {}) as any;

  // mover ctx al envelope (si vino en payload)
  if (p.ctx && typeof p.ctx === "object" && !Array.isArray(p.ctx)) {
    env.ctx = { ...(env.ctx || {}), ...p.ctx };
  }
  // asegurar objeto ctx arriba (opcional)
  if (!env.ctx || typeof env.ctx !== "object") env.ctx = {};

  // asegurar señal objeto
  if (!p.señal || typeof p.señal !== "object") p.señal = {};
  const sig = p.señal;

  // simbolo string
  if (typeof sig.simbolo !== "string" || !sig.simbolo.trim()) {
    sig.simbolo = "📝";
  }

  // payload objeto (envolver si vino primitivo / array / null)
  if (
    sig.payload == null ||
    typeof sig.payload !== "object" ||
    Array.isArray(sig.payload)
  ) {
    sig.payload = { raw: sig.payload ?? null };
  }

  // meta objeto si corresponde
  if (
    sig.meta != null &&
    (typeof sig.meta !== "object" || Array.isArray(sig.meta))
  ) {
    sig.meta = { raw: sig.meta };
  }

  // dejar SOLO señal en payload (ctx ya está arriba)
  env.payload = { señal: sig };
  return env;
}

function validar(msg: unknown) {
  if (!validators.envelope(msg as any)) {
    return { ok: false, where: "envelope", errors: validators.envelope.errors };
  }
  if (!isEnvelope(msg))
    return { ok: false, where: "envelope", errors: ["not an Envelope"] };
  const kind = (msg as any).kind;
  const v = (validators as any)[kind];
  if (v && !v((msg as any).payload))
    return { ok: false, where: kind, errors: v.errors };
  return { ok: true };
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
const mind = new NodeMind({ nombre: "utopy.node@ts" });
const MEM = cargarMemoria();

bootstrapEspora(mind).catch((e) => {
  console.error("⚠️ bootstrapEspora:", String((e as any)?.message || e));
});

function nowISO() {
  return new Date().toISOString();
}
function w(obj: any) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// --- envelope ---
type Envelope = {
  version: "1.0";
  id?: string;
  ref?: string;
  kind: string;
  ts: string;
  nodo_id?: string;
  ctx?: Record<string, any>;
  seguridad?: Record<string, any>;
  payload: any;
};

function isEnvelope(x: unknown): x is Envelope {
  return (
    !!x &&
    (x as any).version === "1.0" &&
    typeof (x as any).kind === "string" &&
    typeof (x as any).ts === "string" &&
    typeof (x as any).payload === "object" &&
    (x as any).payload !== null
  );
}

function toAck(ref: string, nota?: string): Envelope {
  return {
    version: "1.0",
    ref,
    kind: "event.ack",
    ts: nowISO(),
    payload: { ok: true, nota },
  };
}
function toErr(
  ref: string | undefined,
  code: string,
  message: string,
  details?: any
): Envelope {
  return {
    version: "1.0",
    ref,
    kind: "event.error",
    ts: nowISO(),
    payload: { error: { code, message, details } },
  };
}
function toResonancia(ref: string, resonancias: any[]): Envelope {
  return {
    version: "1.0",
    ref,
    kind: "event.resonancia",
    ts: nowISO(),
    payload: { resonancias },
  };
}

function cryptoRandom() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 🔀 Mapea {op,input} → kind y payload esperados por tus schemas/handlers */
function opToKind(opRaw: string): string {
  const op = String(opRaw || "").trim();
  if (!op) return "call.interpretar";
  if (op.startsWith("call.")) return op;
  switch (op) {
    case "ping":
      return "call.ping";
    case "aprender":
      return "call.aprender";
    case "registrar_cap":
      return "call.registrar_cap";
    case "interpretar":
      return "call.interpretar";
    default:
      return "call." + op;
  }
}

/** 🧩 Construye Envelope desde ABI v1 call.request ({op,input}) */
function fromABIcallToEnvelope(abireq: any): Envelope {
  const id = abireq.id ?? cryptoRandom();
  const ts = abireq.ts || nowISO();
  const { op, input } = abireq.payload || {};

  const kind = opToKind(op);
  let payload: any = input ?? {};

  if (kind === "call.interpretar") {
    if (!payload?.señal) {
      const dv: DatoVivo = {
        simbolo: payload?.simbolo || "📝",
        payload:
          payload?.payload ??
          (typeof payload === "object" ? { ...payload } : { raw: payload }),
      };
      payload = { señal: dv, ctx: abireq.ctx ?? {} };
    }
  } else if (kind === "call.aprender") {
    payload = {
      diccionario: payload?.diccionario ?? payload?.dict ?? {},
      intents: Array.isArray(payload?.intents) ? payload.intents : [],
    };
  } else if (kind === "call.registrar_cap") {
    payload = {
      capability: payload?.capability ?? payload?.cap ?? payload ?? {},
    };
  }

  // Fallback: op desconocida → interpretar
  if (!KNOWN_CALLS.has(kind)) {
    const dv: DatoVivo = {
      simbolo: payload?.simbolo || "📝",
      payload:
        payload?.payload ??
        (typeof payload === "object" ? { ...payload } : { raw: payload }),
    };
    return {
      version: "1.0",
      id,
      kind: "call.interpretar",
      ts,
      payload: { señal: dv, ctx: abireq.ctx ?? {} },
    };
  }

  return { version: "1.0", id, kind, ts, payload };
}

// --- handlers ---
async function handle(msg: Envelope) {
  // HOTFIX: si entra ABI v1 directo (kind: call.request), mapear a call.*
  if (msg.kind === "call.sem.tell") {
    msg = { ...msg, kind: "sem.tell" };
  }
  if (msg.kind === "call.request" && msg.payload?.op) {
    const env2 = fromABIcallToEnvelope({
      id: msg.id,
      ts: msg.ts,
      payload: { op: msg.payload.op, input: msg.payload.input },
      ctx: msg.ctx,
    });
    const ver2 = validar(env2 as any);
    if (!ver2.ok)
      return w(
        toErr(
          env2.id,
          "E_SCHEMA",
          `Schema inválido (${ver2.where})`,
          ver2.errors
        )
      );
    return await handle(env2);
  }

  // Coerción previa para cumplir schema de interpretar
  if (msg.kind === "call.interpretar") {
    msg = coerceCallInterpretar(msg);
  }

  // Validación
  const ver = validar(msg as any);
  if (!ver.ok) {
    return w(
      toErr(msg.id, "E_SCHEMA", `Schema inválido (${ver.where})`, ver.errors)
    );
  }

  const { id, kind, payload } = msg;

  try {
    switch (kind) {
      case "call.ping":
        return w(toAck(id!));

      case "sem.ask":
        return w(toAck(id!, "sem.ask recibido"));
      // --- NUEVOS CASES PARA CAMINO ESPORA -----------------------------

      case "call.spore.hello": {
        // Handshake de espora: devolvemos bienvenida + mínimos del nodo
        return w({
          version: "1.0",
          ref: id,
          kind: "event.welcome",
          ts: nowISO(),
          payload: {
            node: { id: (globalThis as any).NODE_ID || "node", ts: nowISO() },
            // Si querés, expone símbolos aprendidos desde tu MEM semántica
            // dict: mind?.diccionarioActual?.() ?? {},
          },
        });
      }

      case "call.dato.create": {
        const { id: dvId, type, attrs } = payload || {};
        if (!dvId || !type) {
          return w(toErr(id, "E_SCHEMA", "dato.create requiere {id, type}"));
        }
        const dv = {
          id: dvId,
          type,
          attrs: attrs || {},
          ts: nowISO(),
        };
        await dvPut(dv);

        // Emití un evento para resonancia/auditoría
        w({
          version: "1.0",
          id: cryptoRandom(),
          kind: "event.dato.created",
          ts: nowISO(),
          payload: { id: dvId, type },
        });

        return w(toAck(id!, "dato creado"));
      }

      case "call.dato.query": {
        const { where, limit = 20 } = payload || {};
        const all = await dvAll();
        const filtered = all
          .filter((dv) => {
            if (!where) return true;
            return Object.entries(where).every(
              ([k, v]) => dv[k] === v || dv?.attrs?.[k] === v
            );
          })
          .slice(0, limit);
        return w({
          version: "1.0",
          ref: id,
          kind: "event.dato.list",
          ts: nowISO(),
          payload: { items: filtered, count: filtered.length },
        });
      }

      case "call.seed.invite": {
        // Genera un deeplink para nacer nuevas esporas
        const prefer = payload?.prefer || "ws";
        const ip = (globalThis as any).HOST_IP || "localhost"; // o pasalo por env/ctx
        const ws = `ws://${ip}:8787`;
        const nodeId = (globalThis as any).NODE_ID || "node";
        const deeplink = `utopy://attach?ws=${encodeURIComponent(
          ws
        )}&id=${encodeURIComponent(nodeId)}&prefer=${encodeURIComponent(
          prefer
        )}`;

        return w({
          version: "1.0",
          ref: id,
          kind: "seed.invite",
          ts: nowISO(),
          payload: {
            manifest: { id: nodeId, ws, prefer },
            deeplink,
          },
        });
      }

      case "sem.tell": {
        const { simbolo, significado, confianza, fuente } = payload || {};
        if (simbolo && significado) {
          mergeSignificado(MEM, simbolo, {
            clase: significado.clase,
            unidad: significado.unidad,
            path: significado.path,
            conf: typeof confianza === "number" ? confianza : 0.6,
            fuente: fuente || "nodo://desconocido",
          });
          guardarMemoria(MEM);
          const top = significadoTop(MEM, simbolo);
          console.error("🧠 aprendido:", simbolo, "→", top);
          return w(
            toAck(id || msg.ref || cryptoRandom(), "aprendido/registrado")
          );
        }
        return w(toErr(msg.id, "E_SCHEMA", "sem.tell incompleto"));
      }

      case "cap.tell": {
        const caps = Array.isArray(payload?.capabilities)
          ? payload.capabilities
          : [];
        upsertCapabilities(caps as Capability[]);
        return w(
          toAck(
            id || msg.ref || cryptoRandom(),
            `capabilities recibidas: ${caps.length}`
          )
        );
      }

      case "cap.ask": {
        const filtro = Array.isArray(payload?.filtro) ? payload.filtro : [];
        const list = findCapabilities(filtro);
        return w({
          version: "1.0",
          ref: id,
          kind: "cap.tell",
          ts: nowISO(),
          payload: {
            capabilities: list.map((c) => ({
              id: c.id,
              kind: c.kind,
              claims: c.claims || [],
              conf: typeof c.conf === "number" ? c.conf : 0.5,
              meta: c.meta || {},
            })),
          },
        });
      }

      case "call.aprender": {
        const { diccionario, intents } = payload ?? {};
        if (diccionario && typeof diccionario === "object")
          mind.aprenderDiccionario(diccionario);
        if (Array.isArray(intents)) {
          /* opcional */
        }
        return w(
          toAck(
            id!,
            `aprendido ${
              diccionario ? Object.keys(diccionario).length : 0
            } símbolos`
          )
        );
      }

      case "call.registrar_cap": {
        const dv: DatoVivo = {
          simbolo: "🧩 capability",
          payload: payload?.capability ?? {},
        };
        await mind.interpretarDato(dv, { origen: "compat" });
        return w(toAck(id!, "cap registrada"));
      }

      case "call.interpretar": {
        let señal: DatoVivo = payload?.señal;
        const ctx = payload?.ctx ?? msg.ctx ?? {};

        const sig = señal?.simbolo ? significadoTop(MEM, señal.simbolo) : null;

        if (señal?.simbolo && sig) {
          señal = {
            ...señal,
            payload: normalizarSegunSignificado(
              señal.simbolo,
              señal.payload,
              sig
            ),
          };
        }
        const res = await mind.interpretarDato(señal, ctx);

        if (res && res.length > 0) {
          // — broker vivo: tolerante a distintas formas de resonancia —
          for (const r of res as any[]) {
            // claim puede venir como evento | event | type
            const claim = String(r?.evento ?? r?.event ?? r?.type ?? "").trim();

            if (!claim) continue;

            // payload puede venir como dato | data | payload | el propio r
            const payloadForCap = r?.dato ?? r?.data ?? r?.payload ?? r;

            const candidates = findCapabilities([claim]);
            if (!candidates.length) continue;

            for (const cap of candidates) {
              emitToCapability(cap, claim, { dato: payloadForCap, ctx }, id);
              // si preferís usar 'data' en vez de 'dato', cambia la key arriba.
            }
          }

          return w(toResonancia(id!, res));
        }

        if (sig) {
          const evento = sig.clase || sig.path || "evento";
          const resonancias = [{ evento, dato: señal?.payload ?? {} }];
          return w(toResonancia(id!, resonancias));
        }

        if (señal?.simbolo) {
          w({
            version: "1.0",
            id: cryptoRandom(),
            kind: "sem.ask",
            ts: nowISO(),
            payload: {
              simbolo: señal.simbolo,
              contexto: {
                canal: ctx?.origen,
                keys: Object.keys(señal?.payload || {}),
              },
            },
          });
        }
        return w(toAck(id!, "preguntando significado"));
      }

      default:
        return w(toErr(id, "E_UNSUPPORTED_KIND", `kind ${kind} no soportado`));
    }
  } catch (e: any) {
    return w(toErr(id, "E_RUNTIME", String(e?.message || e)));
  }
}

// ─── Loop de lectura con Universal Intake ─────────────────────────────────────
rl.on("line", async (line) => {
  try {
    const rawLine = line.replace(/^\uFEFF/, "");
    if (!rawLine.trim()) return;

    // 0) Intento JSON si parece JSON
    let parsed: any = rawLine;
    if (
      rawLine.startsWith("{") ||
      rawLine.startsWith("[") ||
      rawLine.startsWith('"')
    ) {
      try {
        parsed = JSON.parse(rawLine);
      } catch {
        /* se queda string */
      }
    }

    // 1) Si YA es un Envelope v1 cualquiera (eventos/calls/etc.), NO pasar por normalize
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === "1.0" &&
      typeof parsed.kind === "string" &&
      parsed.payload !== undefined
    ) {
      // completar metadatos mínimos
      const env0 = parsed as Envelope;
      if (!env0.ts) (env0 as any).ts = nowISO();
      if (!env0.id && !env0.ref) (env0 as any).id = cryptoRandom();

      // si es call.request, convertir a call.* como antes
      if (env0.kind === "call.request" && env0.payload?.op) {
        const env2 = fromABIcallToEnvelope({
          id: env0.id,
          ts: env0.ts,
          payload: { op: env0.payload.op, input: env0.payload.input },
          ctx: env0.ctx,
        });
        // coerción si corresponde
        if (env2.kind === "call.interpretar") {
          coerceCallInterpretar(env2);
        }
        return await handle(env2);
      }

      // para cualquier otro kind (cap.tell, sem.tell, event.*, call.* ya formadas)
      if (env0.kind === "call.interpretar") {
        coerceCallInterpretar(env0);
      }
      return await handle(env0);
    }

    // 2) NO era envelope → usar universal-intake para normalizar a ABI v1 call.request
    const req = normalizeAnyToABI(parsed);

    // Si Universal Intake devolvió event.error → devolver y salir
    if ((req as any).kind === "event.error") {
      w(req as any);
      return;
    }

    // 3) Convertir ABI call.request → Envelope call.*
    const env = fromABIcallToEnvelope(req);

    // 4) Metadatos mínimos
    if (!env.ts) (env as any).ts = nowISO();
    if (!env.id && !env.ref) (env as any).id = cryptoRandom();

    // 5) Coerción para interpretar y manejar
    if (env.kind === "call.interpretar") {
      coerceCallInterpretar(env);
    }
    await handle(env);
  } catch (e: any) {
    w(toErr(undefined, "E_RUNTIME", String(e?.message || e)));
  }
});
