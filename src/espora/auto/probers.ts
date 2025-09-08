// src/espora/auto/probers.ts
import type { DatoVivo } from "../../core/types/core";
import { NodeMind } from "../../core/mind/NodeMind";

/** Detecciones robustas (web/Node) sin forzar tipos del DOM */
function hasWebRTC(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}

function hasCamera(): boolean {
  if (typeof navigator === "undefined") return false;
  // Evita el warning de TS: usa 'in' y typeof function
  const md: any = (navigator as any).mediaDevices;
  return !!(md && ("getUserMedia" in md) && typeof md.getUserMedia === "function");
}

async function hasFs(): Promise<boolean> {
  try {
    await import("node:fs");
    return true;
  } catch {
    return false;
  }
}

function hasNode(): boolean {
  return typeof process !== "undefined" && !!(process as any).versions?.node;
}

/** Construye el DatoVivo de capability */
function cap(simboloId: string, claims: string[], runtime?: string, extra?: Record<string, any>): DatoVivo {
  return {
    simbolo: "🧩 capability",
    payload: { id: simboloId, claims, runtime, ...(extra || {}) }
  };
}

/**
 * Autodetección de entorno: publica 🧩 capability como DatoVivo
 * - Node       → exec://node, io://fs
 * - WebRTC     → connect://webrtc
 * - Cámara     → sensor://camera
 */
export async function autoProbeEnv(mind: NodeMind): Promise<DatoVivo[]> {
  const out: DatoVivo[] = [];

  if (hasNode()) {
    out.push(cap("exec.node", ["exec://node"], "typescript"));
    if (await hasFs()) out.push(cap("io.fs", ["io://fs"], "node"));
  }

  if (hasWebRTC()) {
    out.push(cap("connect.webrtc", ["connect://webrtc"], "js"));
  }

  if (hasCamera()) {
    out.push(cap("sensor.camera", ["sensor://camera"], "js"));
  }

  // Publicar en la mente (auto-registro de resonador-proxy)…
  for (const d of out) {
    await mind.interpretarDato(d, { origen: "prober" });
  }

  return out;
}
