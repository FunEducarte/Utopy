#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import http from "node:http";
import https from "node:https";
import Ajv from "ajv";
import addFormats from "ajv-formats";

// 👉 Requiere draft-07 en tus schemas
import envelopeSchema from "../schemas/abi/v1/envelope.json";

// 🧠 Universal Intake: acepta string/urlencoded/{call}/{op}/ABI v1/arrays/etc.
import { normalizeAnyToABI } from "./universal-intake";

type Envelope = {
  version: "1.0";
  kind: string;
  ts: string;
  id?: string;
  ref?: string;
  payload: any;
  ctx?: any;
};
const now = () => new Date().toISOString();
const out = (e: Envelope) => process.stdout.write(JSON.stringify(e) + "\n");

// ---------- AJV ----------
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const vEnv = ajv.compile(envelopeSchema as any);

// ---------- Utils ----------
function substitute(obj: any, ctx: Record<string, any>) {
  if (obj == null) return obj;
  if (typeof obj === "string" && obj.startsWith("$")) return ctx[obj.slice(1)];
  if (Array.isArray(obj)) return obj.map((x) => substitute(x, ctx));
  if (typeof obj === "object") {
    const o: any = {};
    for (const k of Object.keys(obj)) o[k] = substitute(obj[k], ctx);
    return o;
  }
  return obj;
}
function toEnvelope(mapped: any): Envelope {
  const e: Envelope = {
    version: "1.0",
    kind: mapped.kind || "event.resonancia",
    ts: mapped.ts || now(),
    payload: mapped.payload ?? {},
    ctx: mapped.ctx ?? {},
  };
  return e;
}
function err(code: string, message: string, details?: any): Envelope {
  return {
    version: "1.0",
    kind: "event.error",
    ts: now(),
    payload: { error: { code, message, details } },
  };
}

// ---------- Carga de códecs ----------
const CODECS_PATH =
  process.env.UTOPY_CODECS ?? path.resolve("runtime/codecs.dinamicos.json");
let CODECS: any[] = [];
try {
  CODECS = JSON.parse(fs.readFileSync(CODECS_PATH, "utf8"));
} catch {
  out(err("E_CODECS", `No pude cargar ${CODECS_PATH}`));
}

// ---------- Helpers de aceptación ----------
function acceptKind(codec: any, kind: string): boolean {
  const acc = codec?.emit?.accept;
  if (!Array.isArray(acc)) return false;
  if (acc.includes("*")) return true;
  return acc.includes(kind);
}

// ---------- Process ----------
function runProcess(cmdLine: string, codec: any) {
  // admite "prog arg1 arg2"
  const parts = cmdLine.split(" ").filter(Boolean);
  const child = spawn(parts[0], parts.slice(1), {
    stdio: ["pipe", "pipe", "inherit"],
  });

  // child.stdout -> Envelope (ingest)
  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const ctx = { line, ts: now() };
    const mapped = substitute(codec.ingest.map, ctx);
    const env = toEnvelope(mapped);
    if (!vEnv(env as any))
      return out(err("E_SCHEMA", "Envelope inválido", vEnv.errors));
    out(env);
  });

  // stdin (cliente upstream) -> (universal intake) -> codec.emit.map -> child.stdin
  const rlIn = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  rlIn.on("line", (line) => {
    if (!line.trim()) return;

    // 1) Parseo flexible con Universal Intake
    let parsed: any = line.trim();
    if (
      parsed.startsWith("{") ||
      parsed.startsWith("[") ||
      parsed.startsWith('"')
    ) {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        /* queda string */
      }
    }

    const req = normalizeAnyToABI(parsed);

    // Si el intake devolvió error de esquema, lo reportamos y no enviamos
    if ((req as any).kind === "event.error") {
      out(req as any);
      return;
    }

    // 2) Chequear aceptación del códec (ej. "call.request" o "*")
    if (!acceptKind(codec, "call.request")) return;

    // 3) Mapear a “wire” usando codec.emit.map (ctx = { ts, payload })
    const ctx = { ts: now(), payload: (req as any).payload };
    const wire = substitute(codec.emit?.map?.value, ctx);

    // 4) Enviar al proceso hijo en JSONL
    try {
      child.stdin.write(JSON.stringify(wire) + "\n");
    } catch (e) {
      out(err("E_STDIN", "No pude escribir al child", String(e)));
    }
  });

  child.on("error", (e) => out(err("E_PROC", String(e))));
  child.on("exit", (code) =>
    out({
      version: "1.0",
      kind: "event.ack",
      ts: now(),
      payload: { ok: true, nota: `process exit ${code}` },
    })
  );
}

// ---------- HTTP (JSONL) ----------
function runHttp(url: string, codec: any) {
  const h = url.startsWith("https") ? https : http;
  h.get(url, (res) => {
    const ct = String(res.headers["content-type"] || "");
    const want = codec.detect?.match?.contentType;
    if (want && !ct.includes(want)) {
      out(err("E_DETECT", `CT mismatch: ${ct}`));
      return;
    }
    const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const raw = JSON.parse(line);
        const ctx = { ...raw, ts: (raw as any).ts || now() };
        const mapped = substitute(codec.ingest.map, ctx);
        const env = toEnvelope(mapped);
        if (!vEnv(env as any))
          return out(err("E_SCHEMA", "Envelope inválido", vEnv.errors));
        out(env);
      } catch (e: any) {
        out(err("E_PARSE", String(e?.message || e)));
      }
    });
  }).on("error", (e) => out(err("E_HTTP", String(e))));
}

// ---------- CSV simple ----------
function runCsv(file: string, codec: any) {
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of rows) {
    if (!line.trim()) continue;
    const col = line.split(",").map((s) => s.trim());
    const ctx = { col, ts: now() };
    const mapped = substitute(codec.ingest.map, ctx);
    const env = toEnvelope(mapped);
    if (!vEnv(env as any)) continue;
    out(env);
  }
}

// ---------- Arranque ----------
function start(target: string) {
  // pequeña detección por forma del target
  const isUrl = /^https?:\/\//.test(target);
  const isCsv = target.endsWith(".csv");

  for (const c of CODECS) {
    if (c.detect?.kind === "process" && !isUrl && !isCsv)
      return runProcess(target, c);
    if (c.detect?.kind === "http" && isUrl) return runHttp(target, c);
    if (c.detect?.kind === "file" && isCsv) return runCsv(target, c);
  }
  out(err("E_NO_CODEC", `No hay códec para ${target}`));
}

const target = process.argv[2];
if (!target) {
  out(err("E_ARGS", "Uso: auto-codecs <process|http-url|path.csv>"));
  process.exit(2);
}
start(target);
