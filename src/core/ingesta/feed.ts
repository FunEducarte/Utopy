// Ingesta: toma ADN poético o JSON y lo pasa al NodeMind
import type { NodeMind } from "../mind/NodeMind";
import type { DatoVivo } from "../types/core";
import { parseADNToDatosVivos } from "./parser";

export async function feedADNText(mind: NodeMind, texto: string, ctx: any = {}) {
  const datos = parseADNToDatosVivos(texto);
  for (const d of datos) {
    await mind.interpretarDato(d as DatoVivo, ctx);
  }
}

export async function feedDatosVivos(mind: NodeMind, datos: DatoVivo[], ctx: any = {}) {
  for (const d of datos) {
    await mind.interpretarDato(d, ctx);
  }
}
