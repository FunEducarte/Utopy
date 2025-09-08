import type { Nodo, DatoVivo as SeñalABI, Resonancia } from "../types/core";
import { NodeMind } from "../mind/NodeMind";

export class NodoBase implements Nodo {
  constructor(public id:string, public entorno:string, public simbolos:string[], private mind:NodeMind){}
  async interpretar(señal:SeñalABI, ctx:any={}): Promise<Resonancia[]> {
    const outs = await this.mind.interpretarDato(señal, ctx);
    for (const o of outs){ o.universal = o.universal||[]; if(!o.universal.includes("dato_en_movimiento")) o.universal.push("dato_en_movimiento"); }
    this.emitir?.(outs, ctx);
    return outs;
  }
  emitir?(r:Resonancia[], ctx?:any): void {}
}
