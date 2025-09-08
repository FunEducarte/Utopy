#!/usr/bin/env node
/**
 * Auditoría pasiva del bus WS:
 * - Se conecta al bus (UTOPY_WS_URL).
 * - Escribe cada línea JSONL a data/audit/audit-YYYY-MM-DD.jsonl
 * - Rotación diaria automática.
 * - Filtro opcional por kinds (UTOPY_AUDIT_ONLY_KINDS="event.resonancia,event.error")
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import WebSocket from "ws";

// ---------- Config ----------
const WS_URL = process.env.UTOPY_WS_URL || "ws://localhost:8787";   
const AUDIT_DIR = path.resolve(process.env.UTOPY_AUDIT_DIR || "data/audit");
const FILE_PREFIX = process.env.UTOPY_AUDIT_PREFIX || "audit";
const ONLY_KINDS = String(process.env.UTOPY_AUDIT_ONLY_KINDS || "").trim(); // "kind1,kind2"
const kindsFilter = ONLY_KINDS ? new Set(ONLY_KINDS.split(",").map(s => s.trim())) : null;

function nowISO() { return new Date().toISOString(); }
function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// ---------- FS helpers ----------
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}
ensureDir(AUDIT_DIR);

let currentDay = ymd();
let currentFd = null;

function openFileForToday() {
  const name = `${FILE_PREFIX}-${currentDay}.jsonl`;
  const filePath = path.join(AUDIT_DIR, name);
  if (currentFd) try { fs.closeSync(currentFd); } catch {}
  currentFd = fs.openSync(filePath, "a"); // append
  return filePath;
}
let currentPath = openFileForToday();

function rotateIfNeeded() {
  const today = ymd();
  if (today !== currentDay) {
    currentDay = today;
    currentPath = openFileForToday();
  }
}

function appendLine(line) {
  rotateIfNeeded();
  // Garantiza salto de línea único
  const out = line.endsWith("\n") ? line : line + "\n";
  fs.writeSync(currentFd, out, null, "utf8");
}

// Para cuando el mensaje no es JSON válido, lo envolvemos mínimamente
function wrapNonJson(line) {
  return JSON.stringify({
    ts: nowISO(),
    kind: "bus.raw",
    payload: { line }
  });
}

// ---------- Filtro ----------
function passFilter(line) {
  if (!kindsFilter) return true;
  try {
    const obj = JSON.parse(line);
    const k = obj?.kind;
    if (!k) return false;
    return kindsFilter.has(k);
  } catch {
    // si no parsea y hay filtro → no lo guardamos
    return false;
  }
}

// ---------- Conexión WS ----------
function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.error(`📝 cap-audit conectado a ${WS_URL} → ${currentPath}`);
  });

  ws.on("message", (buf) => {
    const text = buf.toString("utf8");
    const lines = text.split("\n").filter(Boolean);
    for (const line of lines) {
      const toWrite = passFilter(line)
        ? (isProbablyJson(line) ? line : wrapNonJson(line))
        : null;
      if (toWrite) appendLine(toWrite);
    }
  });

  ws.on("error", (e) => {
    console.error("⚠️ cap-audit WS error:", e?.message || e);
  });

  ws.on("close", (code) => {
    console.error(`🔌 cap-audit desconectado (code=${code}). Reintentando en 1s…`);
    setTimeout(connect, 1000);
  });

  // Heartbeat opcional para saber que estamos vivos (no se envía al bus)
  setInterval(() => rotateIfNeeded(), 15 * 1000);
}

function isProbablyJson(s) {
  const t = s.trim();
  return t.startsWith("{") || t.startsWith("[");
}

// ---------- Señales ----------
process.on("SIGINT", () => {
  try { if (currentFd) fs.closeSync(currentFd); } catch {}
  process.exit(0);
});

// ---------- Arranque ----------
connect();
