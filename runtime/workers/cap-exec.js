#!/usr/bin/env node
// runtime/workers/cap-exec.js — autónomo + simbiótico
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";

const BUS = process.env.UTOPY_WS_URL || "ws://localhost:8787";
const DATA_DIR = process.env.UTOPY_DATA_DIR || path.resolve("data");
const CAP_DIR = path.join(DATA_DIR, "capabilities");
const AUDIT_DIR = process.env.UTOPY_AUDIT_DIR || path.resolve("data/audit");

const ALLOW_PROCESS = process.env.UTOPY_ALLOW_PROCESS === "1"; // off por default
const AUTO_HTTP_BASE = process.env.UTOPY_AUTO_HTTP_BASE || ""; // ej: https://api.midominio.com/
const AUTO_HTTP_ALLOW = (process.env.UTOPY_AUTO_HTTP_ALLOW || "").split(",").map(s=>s.trim()).filter(Boolean); // dominios

fs.mkdirSync(AUDIT_DIR, { recursive: true });
fs.mkdirSync(CAP_DIR, { recursive: true });

const now = () => new Date().toISOString();
const jl = (file, obj) => fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
const AUDIT_FILE = path.join(AUDIT_DIR, "cap-exec.jsonl");

// ——— Memoria de capacidades
const caps = new Map(); // id -> capability  {id,kind,claims,conf,meta}

// —— Utilidades de mapeo/seguridad ——
function envSubst(v) { if (typeof v !== "string") return v; return v.startsWith("$ENV:") ? (process.env[v.slice(5)] ?? "") : v; }
function jpath(obj, p) {
  if (typeof p !== "string" || !p.startsWith("$."))
    return undefined;
  const keys = p.slice(2).split(".");
  let cur = obj;
  for (const k of keys) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}
function mapObject(spec, scope) {
  if (!spec || typeof spec !== "object") return spec;
  const out = Array.isArray(spec) ? [] : {};
  for (const [k, v] of Object.entries(spec)) {
    if (typeof v === "string") {
      out[k] = v.startsWith("$ENV:") ? envSubst(v)
            : v.startsWith("$.") ? jpath(scope, v)
            : v;
    } else if (v && typeof v === "object") out[k] = mapObject(v, scope);
    else out[k] = v;
  }
  return out;
}
function matchWhen(whenArr, scope) {
  if (!Array.isArray(whenArr) || whenArr.length === 0) return true;
  return whenArr.every(w => {
    const val = jpath(scope, w.path);
    if (w.equals !== undefined) return String(val) === String(w.equals);
    if (w.exists) return val !== undefined && val !== null;
    return true;
  });
}
function sameHost(u1, allowDomains=[]) {
  try {
    const h = new URL(u1).hostname.toLowerCase();
    return allowDomains.some(d => {
      const D = d.toLowerCase();
      return h === D || h.endsWith("." + D);
    });
  } catch { return false; }
}
async function httpCall(method, url, headers, body, timeoutMs, allowDomains) {
  if (allowDomains?.length && !sameHost(url, allowDomains)) {
    throw new Error(`domain not allowed: ${url}`);
  }
  const lib = url.startsWith("https") ? https : http;
  const data = body != null ? JSON.stringify(body) : undefined;
  const opts = { method, headers: { "content-type": "application/json", ...(headers||{}) } };
  return await new Promise((resolve, reject) => {
    const req = lib.request(url, opts, res => {
      let buf=""; res.setEncoding("utf8");
      res.on("data", d=> buf+=d);
      res.on("end", ()=> resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.setTimeout(timeoutMs || 10000, ()=> { req.destroy(new Error("timeout")); });
    req.end();
  });
}
async function processExec(cmd, args, inputObj) {
  if (!ALLOW_PROCESS) throw new Error("process transport disabled");
  const { spawn } = await import("node:child_process");
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe","pipe","pipe"] });
    child.stdin.write(JSON.stringify(inputObj) + "\n");
    child.stdin.end();
    let out=""; child.stdout.on("data", c=> out+=c.toString("utf8"));
    let err=""; child.stderr.on("data", c=> err+=c.toString("utf8"));
    child.on("error", reject);
    child.on("exit", (code)=> resolve({ code, stdout: out, stderr: err }));
  });
}

// —— Carga/descubrimiento de capacidades ——
function learnCapability(c) {
  if (!c?.id || !c?.kind) return;
  const norm = {
    id: String(c.id),
    kind: String(c.kind),
    claims: Array.isArray(c.claims) ? c.claims.map(String) : [],
    conf: typeof c.conf === "number" ? c.conf : 0.5,
    meta: c.meta && typeof c.meta === "object" ? c.meta : {}
  };
  caps.set(norm.id, norm);
  jl(AUDIT_FILE, { ts: now(), event: "cap.learn", cap: norm });
}
function loadCapsFromDir() {
  for (const f of fs.readdirSync(CAP_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(CAP_DIR, f), "utf8"));
      const arr = Array.isArray(obj) ? obj : (obj?.capabilities || []);
      for (const c of arr) learnCapability(c);
    } catch (e) {
      jl(AUDIT_FILE, { ts: now(), event: "cap.load.error", file: f, err: String(e) });
    }
  }
}
function watchCapsDir() {
  fs.watch(CAP_DIR, { persistent:true }, (_e, fname) => {
    if (!fname || !fname.endsWith(".json")) return;
    setTimeout(() => { // debounce simple
      try {
        const full = path.join(CAP_DIR, fname);
        if (!fs.existsSync(full)) return;
        const obj = JSON.parse(fs.readFileSync(full, "utf8"));
        const arr = Array.isArray(obj) ? obj : (obj?.capabilities || []);
        for (const c of arr) learnCapability(c);
        jl(AUDIT_FILE, { ts: now(), event: "cap.reload", file: fname, count: arr.length });
      } catch (e) {
        jl(AUDIT_FILE, { ts: now(), event: "cap.reload.error", file: fname, err: String(e) });
      }
    }, 200);
  });
}
function loadCapsFromEnv() {
  // UTOPY_CAP_JSON={"capabilities":[{...}]}
  if (process.env.UTOPY_CAP_JSON) {
    try {
      const obj = JSON.parse(process.env.UTOPY_CAP_JSON);
      const arr = Array.isArray(obj) ? obj : (obj?.capabilities || []);
      for (const c of arr) learnCapability(c);
    } catch (e) {
      jl(AUDIT_FILE, { ts: now(), event: "cap.env.error", err: String(e) });
    }
  }
  // UTOPY_CAP_FILE1=/path/a.json  (puedes enumerar varias: _FILE2, _FILE3…)
  for (const k of Object.keys(process.env).filter(k => k.startsWith("UTOPY_CAP_FILE"))) {
    try {
      const p = process.env[k];
      if (!p) continue;
      const obj = JSON.parse(fs.readFileSync(p, "utf8"));
      const arr = Array.isArray(obj) ? obj : (obj?.capabilities || []);
      for (const c of arr) learnCapability(c);
    } catch (e) {
      jl(AUDIT_FILE, { ts: now(), event: "cap.envfile.error", key: k, err: String(e) });
    }
  }
}

// —— Síntesis de capabilities (fallback) ——
const TEMPLATES = {
  "sendMessage": (input/*{to,text}*/) => ({
    transport: "http",
    endpoint: AUTO_HTTP_BASE ? `${AUTO_HTTP_BASE.replace(/\/+$/,"")}/notify` : "",
    method: "POST",
    headers: { },
    policy: { allowDomains: AUTO_HTTP_ALLOW, timeoutMs: 6000 },
    map: { to: "$.dato.to", text: "$.dato.text", source: "utopy" }
  }),
  "asset.create": () => ({
    transport: "http",
    endpoint: AUTO_HTTP_BASE ? `${AUTO_HTTP_BASE.replace(/\/+$/,"")}/asset` : "",
    method: "POST",
    policy: { allowDomains: AUTO_HTTP_ALLOW, timeoutMs: 8000 },
    map: { ...{ symbol: "$.dato.simbolo" }, ...{ payload: "$.dato.payload" } }
  }),
  "trade.create": () => ({
    transport: "http",
    endpoint: AUTO_HTTP_BASE ? `${AUTO_HTTP_BASE.replace(/\/+$/,"")}/trade` : "",
    method: "POST",
    policy: { allowDomains: AUTO_HTTP_ALLOW, timeoutMs: 8000 },
    map: { ...{ buyer: "$.dato.buyer", seller: "$.dato.seller" }, ...{ item: "$.dato.item", qty: "$.dato.qty" } }
  })
};

function synthesizeCapabilityForClaim(claim) {
  if (!AUTO_HTTP_BASE) return null;               // no base => no síntesis
  if (!TEMPLATES[claim]) return null;             // sin template => no síntesis
  const meta = TEMPLATES[claim]();
  if (!meta.endpoint) return null;
  const id = `cap:auto:${claim}`;
  const cap = { id, kind: "actor.synthetic", claims: [claim], conf: 0.6, meta };
  learnCapability(cap);
  jl(AUDIT_FILE, { ts: now(), event: "cap.synth", claim, id });
  return cap;
}

// —— Ejecución ——
async function executeClaim(cap, claim, input, ctx) {
  const meta = cap.meta || {};
  const transport = String(meta.transport || "echo");

  if (!matchWhen(meta.when, { dato: input, ctx, cap })) {
    return { skipped: true, reason: "when-mismatch" };
  }

  const scope = { dato: input, ctx, cap };
  const payload = mapObject(meta.map || {}, scope);

  if (transport === "echo") return { ok: true, echo: payload };

  if (transport === "http") {
    const url = envSubst(meta.endpoint);
    const method = (meta.method || "POST").toUpperCase();
    const headers = mapObject(meta.headers || {}, scope);
    const res = await httpCall(method, url, headers, payload, meta.policy?.timeoutMs, meta.policy?.allowDomains);
    return { ok: true, http: { status: res.status, body: res.body } };
  }

  if (transport === "process") {
    const cmd = meta.command; const args = Array.isArray(meta.args) ? meta.args : [];
    if (!cmd) throw new Error("process: command required");
    const res = await processExec(cmd, args, payload);
    return { ok: true, process: res };
  }

  if (transport === "audit") {
    jl(AUDIT_FILE, { ts: now(), event: "cap.exec.audit", cap: cap.id, claim, input, payload, ctx });
    return { ok: true, audit: true };
  }

  throw new Error(`unknown transport: ${transport}`);
}

// —— WS ——
const ws = new WebSocket(BUS);
ws.on("open", () => {
  console.log("🧠 cap-exec autónomo conectado a", BUS);
  // boot: aprender de disco y env
  loadCapsFromDir(); watchCapsDir(); loadCapsFromEnv();
});
ws.on("error", e => console.error("cap-exec WS error:", e));
ws.on("close", ()=> console.log("cap-exec desconectado"));
const send = obj => (ws.readyState===1) && ws.send(JSON.stringify(obj)+"\n");

// —— Mensajería ——
// 1) Aprende cap.tell
// 2) Atiende call.request dirigido (ctx.target_cap)
// 3) (Opcional) escucha event.resonancia -> emite cap.ask si falta
ws.on("message", async (buf) => {
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    let msg; try { msg = JSON.parse(line); } catch { continue; }

    // cap.tell => aprender
    if (msg.kind === "cap.tell" && Array.isArray(msg.payload?.capabilities)) {
      for (const c of msg.payload.capabilities) learnCapability(c);
      send({ version:"1.0", ref: msg.id || msg.ref, kind:"event.ack", ts: now(), payload:{ ok:true }});
      continue;
    }

    // event.resonancia => si no hay cap local para el claim, preguntar/sintetizar
    if (msg.kind === "event.resonancia") {
      const rs = Array.isArray(msg.payload?.resonancias) ? msg.payload.resonancias : [];
      for (const r of rs) {
        const claim = String(r?.evento || "").trim();
        if (!claim) continue;
        const has = [...caps.values()].some(c => (c.claims||[]).includes(claim));
        if (!has) {
          // 1) preguntar a la red
          send({ version:"1.0", id: cryptoRandom(), kind:"cap.ask", ts: now(), payload:{ filtro:[claim] }});
          // 2) sintetizar local si tenemos base + template
          const syn = synthesizeCapabilityForClaim(claim);
          if (syn) {
            // broker ya enviará call.request dirigido cuando corresponda;
            // si querés disparar directo aquí, podrías hacerlo.
          }
        }
      }
      continue;
    }

    // call.request dirigido
    if (msg.kind === "call.request" && msg.ctx?.target_cap) {
      const cap = caps.get(msg.ctx.target_cap);
      if (!cap) {
        send({ version:"1.0", ref: msg.id, kind:"event.error", ts: now(), payload:{ error:{ code:"E_NO_CAP", message:`no capability ${msg.ctx.target_cap}`}}});
        continue;
      }
      const claim = msg.payload?.op;
      try {
        const result = await executeClaim(cap, claim, msg.payload?.input?.dato ?? msg.payload?.input, msg.ctx || {});
        jl(AUDIT_FILE, { ts: now(), event: "cap.exec", cap: cap.id, claim, result });
        send({ version:"1.0", ref: msg.id, kind:"event.ack", ts: now(), payload:{ ok:true, result }});
      } catch (e) {
        jl(AUDIT_FILE, { ts: now(), event: "cap.exec.error", cap: cap.id, claim, err: String(e) });
        send({ version:"1.0", ref: msg.id, kind:"event.error", ts: now(), payload:{ error:{ code:"E_EXEC", message:String(e) } }});
      }
    }
  }
});

function cryptoRandom() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,(c)=> {
    const r=(Math.random()*16)|0, v=c==="x"?r:(r&0x3)|0x8; return v.toString(16);
  });
}
