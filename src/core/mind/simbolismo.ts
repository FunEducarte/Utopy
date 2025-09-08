// core/mind/simbolismo.ts
import { NodeMind } from "./NodeMind";

export function interpretarBloqueSimbólico(
  emoji: string,
  payload: string,
  mind: NodeMind
): { key: string; value: any } | null {
  const lineas = payload
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const significado = mind.memoria.simbolismos[emoji]?.significado || "";
  const tipo = mind.memoria.simbolismos[emoji]?.relaciones?.tipo;

  if (tipo === "module") {
    const obj: Record<string, string> = {};
    for (const linea of lineas) {
      const [k, v] = linea.split("=").map((s) => s.trim());
      if (k && v) obj[k] = v;
    }
    obj.type = emoji;
    return { key: "modules", value: obj };
  }

  if (tipo === "meta") {
    const valor = lineas.join(" ");
    if (significado.includes("nombre")) return { key: "name", value: valor };
    if (significado.includes("descripción")) return { key: "description", value: valor };
    if (significado.includes("símbolo")) return { key: "tokenSymbol", value: valor };
  }

  if (lineas.length === 1 && /^[A-Z]{2,5}$/.test(lineas[0])) {
    return { key: "tokenSymbol", value: lineas[0] };
  }

  return { key: "custom", value: lineas.join("\n") };
}
