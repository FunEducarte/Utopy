import { NodeMind } from "../../core/mind/NodeMind";
import { registerLocalPerform } from "./perform-router";

/**
 * Anuncia una capability local (TS) y registra la función en el router.
 * No hace falta registrar resonadores: el Mind creará el proxy al recibir la capability.
 */
export function registerLocalPerformCapability(
  mind: NodeMind,
  id: string,
  claims: string[],
  fn: (params:any)=>Promise<any>|any
) {
  // publica como Dato Vivo (monismo)
  mind.interpretarDato(
    { simbolo: "🧩 capability", payload: { id, claims, runtime: "typescript", entry: `local:${id}` } },
    { origen: "local" }
  );
  // function binding para ejecuciones
  registerLocalPerform(id, fn);
}
