// src/core/mind/ActiveContext.ts
import type { NodeMind } from "./NodeMind";

let activeMind: NodeMind | null = null;

export function setActiveNodeMind(mind: NodeMind | null) {
  activeMind = mind;
}

export function getActiveNodeMind(): NodeMind | null {
  return activeMind;
}
