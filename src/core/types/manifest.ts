// src/core/types/manifest.ts (interno, no contrato)
export type Json = string|number|boolean|null|{[k:string]:Json}|Json[];

export type NodeManifest = {
  nombre?: string;
  roles?: string[];                            // ej: ["productor","comprador"]
  canales?: Array<{ simbolo: string; meta?: Json }>; // ej: [{simbolo:"🎥"},{simbolo:"📄"}]
  intents?: Array<{ id: string; requiere?: string[]; meta?: Json }>;
  diccionario?: Record<string,string[]>;
  politicas?: Json;                            // opcional
  meta?: Json;                                 // libre
};
