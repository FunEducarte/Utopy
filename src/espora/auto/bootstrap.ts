import { NodeMind } from "../../core/mind/NodeMind";
import { autoLoadCapsFromDisk } from "./cap-loader";
import { autoProbeEnv } from "./probers";

/**
 * Llama a todos los descubridores/sondas de capacidades.
 * Idempotente y seguro para producción.
 */
export async function bootstrapEspora(mind: NodeMind) {
  await autoProbeEnv(mind);          // publica caps del entorno (si existen)
  await autoLoadCapsFromDisk(mind);  // publica caps definidas en runners/*.cap.json
  // Si querés registrar locales en código, importá y llamá registerLocalPerformCapability(...) aquí.
}
