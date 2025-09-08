export type Simbolo = string; // 🎥, 📄, 🌡️, etc.

export type DatoVivo = {
  simbolo: Simbolo;
  payload?: any;
  meta?: Record<string, any>;
  seguridad?: any;
};

export type Señal = DatoVivo;

export type Resonancia = {
  tipo: string;
  valor: any;
  universal?: string[];
};

export interface Nodo {
  id: string;
  entorno: string;
  simbolos: Simbolo[];
  interpretar(s: Señal, ctx?: any): Promise<Resonancia[]>;
  emitir?(r: Resonancia[], ctx?: any): void;
}
