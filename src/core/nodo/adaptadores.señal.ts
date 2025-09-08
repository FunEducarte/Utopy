// src/core/nodo/adaptadores.señal.ts
import type { DatoVivo } from "../types/core";
import type { Señal as RunnerSeñal } from "./tipos";

export function toRunnerSeñal(d: DatoVivo, origen = "abi"): RunnerSeñal {
  const s = (d.simbolo || "").toLowerCase();
  let tipo: RunnerSeñal["tipo"] = "evento";
  if (s === "🌡️" || s === "temp" || s.includes("sensor")) tipo = "sensor";
  if (s === "📄" || s === "doc"  || s.includes("contrato")) tipo = "archivo";
  if (s === "🎥" || s.includes("video")) tipo = "evento";
  if (s.includes("perform") || s.includes("capability")) tipo = "evento";
  return { tipo, origen, payload: d.payload, meta: d.meta || {} };
}
