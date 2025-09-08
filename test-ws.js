// test-ws.js
import WebSocket from "ws";

const URL = process.env.UTOPY_WS_URL || "ws://localhost:8787";
const ws = new WebSocket(URL);

const sendLine = (obj) => {
  const line = (typeof obj === "string") ? obj.trim() : JSON.stringify(obj);
  ws.send(line + "\n");
};

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

ws.on("open", async () => {
  console.log("✅ Conectado al bus", URL);

  // --- 1) Registrar una capability mock (cap:echo) ---
  sendLine({
    version: "1.0",
    kind: "cap.tell",
    ts: new Date().toISOString(),
    payload: {
      capabilities: [
        {
          id: "cap:echo",
          kind: "mock.echo",
          claims: ["sendMessage", "log"],
          conf: 0.9,
          meta: { note: "demo mock" }
        }
      ]
    }
  });

  await sleep(100);

  // --- 2) Invocarla directo (sin pasar por broker) ---
  sendLine({
    version: "1.0",
    kind: "call.request",
    ts: new Date().toISOString(),
    payload: {
      op: "sendMessage",
      input: { to: "Juan", text: "Hola desde invocación directa" }
    },
    ctx: { target_cap: "cap:echo", capability_kind: "mock.echo" }
  });

  await sleep(100);

  // --- 3) Enseñar significado y disparar el broker ---
  // 3.1 teach: 💬 -> sendMessage
  sendLine({
    version: "1.0",
    kind: "sem.tell",
    ts: new Date().toISOString(),
    payload: {
      simbolo: "💬",
      significado: { clase: "sendMessage" },
      confianza: 0.95,
      fuente: "test"
    }
  });

  await sleep(100);

  // 3.2 interpretar con 💬 (broker debe rutear a cap:echo)
  sendLine({
    op: "interpretar",
    input: { simbolo: "💬", payload: { to: "Juan", text: "Hola desde broker" } }
  });

  // --- 4) Variantes para probar Universal Intake ---
  await sleep(100);

  // 4.1 String simple
  sendLine("ping");

  // 4.2 Objeto directo {op}
  sendLine({ op: "ping", input: { msg: "hola bus" } });

  // 4.3 Compat {call}
  sendLine({ call: { op: "ping", input: { foo: "bar" } } });

  // 4.4 urlencoded
  sendLine("op=ping&msg=hola&x=1");

  // 4.5 Array estilo ["ping",{...}]
  sendLine(["ping", { msg: "desde array" }]);

  // 4.6 ABI v1 completo
  sendLine({
    version: "1.0",
    kind: "call.request",
    ts: new Date().toISOString(),
    payload: { op: "ping", input: { msg: "abi v1" } }
  });

  // 4.7 Ejemplos de DatoVivo “clásicos”
  sendLine({
    op: "dato.create",
    input: {
      id: "mt:producto:123",
      type: "producto",
      attrs: { nombre: "Dulce de leche", precio: 12000, unidad: "kg", stock: 5 }
    }
  });

  sendLine({ op: "dato.query", input: { where: { type: "producto" }, limit: 10 } });
});

ws.on("message", (buf) => {
  const lines = buf.toString("utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      console.log("📥", msg);
    } catch {
      console.log("📥 (raw)", line);
    }
  }
});

ws.on("close", () => console.log("🔌 Cerrado"));
ws.on("error", (e) => console.error("🚨 WS error:", e));
