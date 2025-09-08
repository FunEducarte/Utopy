// runtime/lib/bus-client.js
import WebSocket from "ws";

const WS_URL = process.env.UTOPY_WS_URL || "ws://localhost:8787";

export function connectBus({ onLine } = {}) {
  const ws = new WebSocket(WS_URL);
  const sendLine = (objOrString) => {
    const line = typeof objOrString === "string" ? objOrString.trim() : JSON.stringify(objOrString);
    if (ws.readyState === WebSocket.OPEN) ws.send(line + "\n");
  };

  ws.on("open", () => {
    console.log("🛰️  bus-client conectado:", WS_URL);
  });

  ws.on("message", (buf) => {
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        onLine && onLine(msg, sendLine);
      } catch {
        // ignorar líneas no JSON
      }
    }
  });

  ws.on("close", () => console.log("🔌 bus-client cerrado"));
  ws.on("error", (e) => console.error("🚨 bus-client error:", e));

  return { ws, sendLine };
}

// Helpers ABI v1
export const nowISO = () => new Date().toISOString();

export function ack(ref, nota) {
  return { version: "1.0", ref, kind: "event.ack", ts: nowISO(), payload: { ok: true, nota } };
}
export function err(ref, code, message, details) {
  return { version: "1.0", ref, kind: "event.error", ts: nowISO(), payload: { error: { code, message, details } } };
}

// Emite un call.request a otra capability (útil en encadenamientos)
export function emitCall(sendLine, { op, input, ctx = {}, ref }) {
  sendLine({ version: "1.0", ref, kind: "call.request", ts: nowISO(), payload: { op, input }, ctx });
}
