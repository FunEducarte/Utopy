// src/core/mind/Memory.ts
export type SymbolInfo = {
  significado: string;
  relaciones?: {
    tipo?: string;
    sinónimos?: string[];
    aplicaciones?: string[];
  };
  historial?: string[];
  /** opcional: requisitos simbólicos */
  requiere?: string[];
  /** opcional: acción simbiótica (solo ref; no es parte del ABI) */
  accion?: (config: Record<string, any>, mind: any) => Promise<void>;
};

export type NodeMemory = {
  /** historial de estados/“manifiestos” observados (flexible) */
  adnHistorial: Array<Record<string, any>>;
  nodosConocidos: string[];
  simbolosAprendidos: string[];
  resonancias: {
    symbol: string;
    intensidad: number;
    contexto: string;
    origen: string;
  }[];
  log: string[];
  simbolismos: Record<string, SymbolInfo>;
};

export function crearMemoriaInicial(seed: Record<string, any> = {}): NodeMemory {
  return {
    adnHistorial: [seed],
    nodosConocidos: [],
    simbolosAprendidos: [],
    resonancias: [],
    log: [],
    simbolismos: {},
  };
}
