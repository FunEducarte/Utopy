// core/mind/understanders.ts
export type Intent = {
  action: string;           // libre: "deploy", "connect", "learn", etc.
  claims?: string[];        // etiquetas libres que guían capacidades ("deploy.web", "sensor.qr"...)
  params?: Record<string, any>;
};

export type UnderstandResult = {
  confidence: number;       // 0..1
  intents: Intent[];
  tokens?: string[];        // palabras/símbolos que el nodo debería aprender
  notes?: string;
};

export type Understander = {
  id: string;
  priority?: number;        // mayor => primero
  understand: (input: { text: string }) => Promise<UnderstandResult>;
};

const REG: Understander[] = [];
export function registerUnderstander(u: Understander) { REG.push(u); }
export function listUnderstanders() { return [...REG].sort((a,b) => (b.priority??0)-(a.priority??0)); }
