// src/core/nodo/index.ts
import type { Cap, Resonador, Runner, Señal } from "./tipos";
import { claimMatches, multiClaimMatches, entornoActual, matchesEntorno } from "./tipos";

let RESONADORES: Resonador[] = [];
let RUNNERS: Runner[] = [];

export function registrarResonadores(rs: Resonador[]) {
  RESONADORES.push(...rs);
}

export function obtenerResonadores(filtrarPorEntorno = true): Resonador[] {
  if (!filtrarPorEntorno) return [...RESONADORES];
  const env = entornoActual();
  return RESONADORES.filter((r) => matchesEntorno(r.entornos, env));
}

export function seleccionarResonadorPorClaim(claim: Cap | Cap[]): { r: Resonador; cap: Cap | Cap[]; score: number } | null {
  const env = entornoActual();
  const isMulti = Array.isArray(claim);
  const candidatos = obtenerResonadores(true)
    .map((r) => {
      const caps = r.caps || [];
      let score = 0;
      if (isMulti) {
        score = multiClaimMatches(claim as Cap[], caps);
      } else {
        score = Math.max(...caps.map((c) => claimMatches(claim as Cap, c)), 0);
      }
      return { r, cap: claim, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidatos[0] || null;
}

export function registrarRunners(rs: Runner[]) {
  RUNNERS.push(...rs);
}

export function planificar(señal: Señal) {
  const ext = señal.payload?.ext as string | undefined;
  const lenguaje = señal.payload?.lenguaje as string | undefined;
  const candidato = RUNNERS.find((r) => r.puedeEjecutar({ ext, lenguaje }));
  return { runner: candidato, args: { ...señal.payload } };
}

export async function ejecutarPlan(plan: ReturnType<typeof planificar>) {
  if (!plan.runner) throw new Error("No hay runner compatible");
  return plan.runner.ejecutar(plan.args);
}
