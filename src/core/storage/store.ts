// src/core/storage/store.ts
import fs from "node:fs";
import path from "node:path";

export type StoreOptions = {
  baseDir?: string;          // carpeta raíz
  namespace?: string;        // subcarpeta por app/nodo
};

const DEFAULTS: Required<StoreOptions> = {
  baseDir: path.resolve(".utopy"),
  namespace: "default"
};

export class ResonanceStore {
  private opts: Required<StoreOptions>;
  private dir: string;

  constructor(options?: StoreOptions) {
    // 👇 FIX: primero mergeamos opciones, luego usamos
    this.opts = { ...DEFAULTS, ...(options ?? {}) };
    this.dir = path.join(this.opts.baseDir, this.opts.namespace);

    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Guarda una resonancia como JSONL (una por línea) */
  appendResonancia(res: unknown) {
    const file = path.join(this.dir, "resonancias.jsonl");
    fs.appendFileSync(file, JSON.stringify(res) + "\n", "utf8");
  }

  /** Guarda/actualiza el estado vivo del nodo (snapshot JSON) */
  saveState(state: unknown) {
    const file = path.join(this.dir, "state.json");
    fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
  }

  /** Lee todas las resonancias (stream simple) */
  readAllResonancias(): unknown[] {
    const file = path.join(this.dir, "resonancias.jsonl");
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split("\n").map(l => l.trim()).filter(Boolean);
    const out: unknown[] = [];
    for (const l of lines) {
      try { out.push(JSON.parse(l)); } catch { /* linea inválida, la saltamos */ }
    }
    return out;
  }
}
