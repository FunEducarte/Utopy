import fs from "node:fs";
import path from "node:path";

type Codec = {
  id: string;
  source: "stdin"|"http"|"file";
  format: "json"|"jsonl"|"text"|"csv";
  match?: { contains?: string; startsWith?: string; regex?: string };
  map: { simbolo: string; from?: "root"|"line"; path?: string }; // path tipo JSONPath sencillo
};

// --- helpers --------------------------------------------------------
function stripBOM(s: string) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

function parseJsonSafe<T = any>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

function parseJsonlSafe(s: string): any[] {
  const out: any[] = [];
  const lines = s.split(/\r?\n/);
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const obj = parseJsonSafe(t);
    if (obj !== null) out.push(obj);
  }
  return out;
}

function parseCsvSimple(s: string): any[] {
  const rows = s.trim().split(/\r?\n/);
  if (rows.length === 0) return [];
  const headers = rows[0].split(",").map(h => h.trim());
  const body = rows.slice(1);
  return body.map(r => {
    const cols = r.split(",");
    const o: any = {};
    headers.forEach((k, i) => { o[k] = (cols[i] ?? "").trim(); });
    return o;
  });
}

// mini JSONPath muy simple: a.b.c
function jp(obj: any, p?: string) {
  if (!p) return obj;
  return p.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}

// --- core -----------------------------------------------------------
export async function runAutoCodecs(inputRaw: string, env: "stdin" | "http" | "file") {
  const file = path.resolve("codecs.dinamicos.json");
  const codecs: Codec[] = fs.existsSync(file)
    ? parseJsonSafe<Codec[]>(stripBOM(fs.readFileSync(file, "utf8"))) || []
    : [];

  const input = stripBOM(inputRaw);

  for (const c of codecs) {
    if (c.source !== env) continue;

    // matching tolerante
    const pass =
      (c.match?.startsWith ? input.startsWith(c.match.startsWith) : true) &&
      (c.match?.contains ? input.includes(c.match.contains) : true) &&
      (c.match?.regex ? new RegExp(c.match.regex, "m").test(input) : true);

    if (!pass) continue;

    // parse según formato
    let items: any[] = [];
    if (c.format === "json") {
      const obj = parseJsonSafe(input);
      if (obj == null) continue;
      items = [obj];
    } else if (c.format === "jsonl") {
      items = parseJsonlSafe(input);
      if (!items.length) continue;
    } else if (c.format === "text") {
      items = input.split(/\r?\n/).map(line => ({ line }));
    } else if (c.format === "csv") {
      items = parseCsvSimple(input);
      if (!items.length) continue;
    }

    // map → DatoVivo[]
    const dvl = items.map((it) => {
      const payload =
        c.map.from === "line"
          ? { raw: String(it.line ?? "") }
          : (jp(it, c.map.path) ?? it);
      return { simbolo: c.map.simbolo, payload };
    });

    if (dvl.length) return dvl; // primer codec que “agarra”
  }
  return null;
}
