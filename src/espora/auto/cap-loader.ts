import fs from "node:fs/promises";
import path from "node:path";
import { NodeMind } from "../../core/mind/NodeMind";

type CapSpec = {
  id: string;
  claims: string[];
  runtime?: string;
  entry?: string;
  meta?: Record<string, any>;
};

export async function autoLoadCapsFromDisk(mind: NodeMind, baseDir = "runners") {
  try {
    const files = await walk(baseDir);
    const specs = files.filter(f => f.toLowerCase().endsWith(".cap.json"));
    for (const f of specs) {
      try {
        const raw = await fs.readFile(f, "utf8");
        const spec = JSON.parse(raw) as CapSpec;
        if (!spec?.id || !(spec?.claims?.length)) continue;
        await mind.interpretarDato({ simbolo: "🧩 capability", payload: spec }, { origen: "disk", path: f });
      } catch (e) {
        // no corta el proceso por un archivo defectuoso
        console.error("⚠️ Error cargando capability:", f, String((e as any)?.message || e));
      }
    }
  } catch (e) {
    // si no existe la carpeta, no es error fatal
    if ((e as any)?.code !== "ENOENT") {
      console.error("🛑 autoLoadCapsFromDisk:", String((e as any)?.message || e));
    }
  }
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
