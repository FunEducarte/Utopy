#!/usr/bin/env tsx
import { WebSocketServer, WebSocket } from "ws";
import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

// -------- config --------
const PORT = Number(process.env.UTOPY_WS_PORT || 8787);

// -------- preparar comando NodeMind --------
const rawCmd = process.env.UTOPY_NODE_CMD || "tsx";
let CMD = rawCmd;
let ARGS: string[] = [];

try {
  ARGS = JSON.parse(process.env.UTOPY_NODE_ARGS || "[]");
} catch {
  ARGS = [];
}

// require() compatible con ESM (para resolver rutas de paquetes)
const require = createRequire(import.meta.url);

// Resuelve el bin real de un paquete leyendo su package.json
function resolvePkgBin(pkgName: string, binKey?: string): string {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  let rel: string | undefined;

  if (typeof pkg.bin === "string") {
    rel = pkg.bin;
  } else if (pkg.bin && typeof pkg.bin === "object") {
    rel = (binKey && pkg.bin[binKey]) || pkg.bin[pkgName] || Object.values(pkg.bin)[0];
  }

  if (!rel) throw new Error(`No se encontró campo bin en ${pkgName}/package.json`);
  return path.resolve(pkgDir, rel);
}

// Si pidieron "tsx ..." o "npx tsx ...", lo convertimos a "node <tsx-cli> ..."
if (rawCmd === "tsx" || (rawCmd === "npx" && ARGS[0] === "tsx")) {
  const tsxCli = resolvePkgBin("tsx", "tsx"); // normalmente → dist/cli.mjs
  CMD = process.execPath; // ejecutable de Node actual
  const rest = rawCmd === "npx" ? ARGS.slice(1) : ARGS;
  ARGS = [tsxCli, ...rest];
}

// -------- ws server --------
const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.on("message", (data) => {
    try {
      const line = typeof data === "string" ? data : data.toString("utf8");
      child.stdin.write(line.trim() + "\n");
    } catch (e) {
      console.error("WS → NODE stdin error:", e);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

console.log(`🌐 WS-bus on port ${PORT}`);

// -------- arrancar NodeMind --------
console.log(`🧠 NodeMind cmd: ${CMD} ${ARGS.join(" ")}`);
const child = spawn(CMD, ARGS, {
  stdio: ["pipe", "pipe", "pipe"],
  shell: false, // ya evitamos .cmd, no hace falta shell:true
});

// helper: broadcast JSONL line a todos los clientes
function bcast(line: string) {
  const msg = line.trim();
  if (!msg) return;
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

// leer stdout del NodeMind (JSONL) y reenviar a clientes
let stdoutBuf = "";
child.stdout.on("data", (chunk: Buffer) => {
  stdoutBuf += chunk.toString("utf8");
  const parts = stdoutBuf.split("\n");
  stdoutBuf = parts.pop() || "";
  for (const p of parts) {
    const s = p.trim();
    if (s) bcast(s);
  }
});

// mostrar stderr
child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
});

// errores / salida
child.on("error", (err) => {
  console.error("💥 NodeMind error", err);
});
child.on("exit", (code) => {
  console.error(`💀 NodeMind exit ${code ?? "?"}`);
});

// salida limpia
process.on("SIGINT", () => {
  try { child.kill("SIGINT"); } catch {}
  try { wss.close(); } catch {}
  process.exit(0);
});
