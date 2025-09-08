// runtime/lib/persist.js
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.UTOPY_DATA_DIR || path.resolve("data");
const AUDIT_DIR = path.join(ROOT, "audit");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function appendJSONL(namespace, obj) {
  ensureDir(AUDIT_DIR);
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const file = path.join(AUDIT_DIR, `${namespace}-${day}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
  return file;
}
