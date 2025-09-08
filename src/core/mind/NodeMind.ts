// src/core/mind/NodeMind.ts
// 🧠 Orquestador ABI-first (agnóstico de lenguaje, monismo de Datos Vivos)

import { crearMemoriaInicial, NodeMemory, SymbolInfo } from "./Memory";
import { obtenerResonadores, planificar, ejecutarPlan, seleccionarResonadorPorClaim as seleccionarCore, registrarResonadores } from "../nodo";
import type { Cap, Resonador, Señal as RunnerSeñal } from "../nodo/tipos";
import { listUnderstanders, UnderstandResult } from "./understanders";
import type { DatoVivo, Resonancia } from "../types/core";
import { toRunnerSeñal } from "../nodo/adaptadores.señal";
import { addCapability, findByClaim } from "./capabilities.store";
import { routePerform } from "../../espora/auto/perform-router";

/** Fallback structuredClone */
const cloneAny: <T>(o: T) => T =
  (globalThis as any).structuredClone || ((o: any) => JSON.parse(JSON.stringify(o)));

export type NodeMindInit = {
  nombre?: string;
  descripcion?: string;
  diccionario?: Record<string, string>;
  intents?: Array<{ id: string; requiere?: string[] }>;
  experiencias?: string[];
};

/** Capabilities enchufables (hooks) */
type CapabilitiesMap = {
  onSignal?: (señal: any) => any | Promise<any>;
  onThink?: (ctx: { tick: number; estado: any }) => any | Promise<any>;
  interpretarBloque?: (ctx: { bloque: string; id?: string }) => any | Promise<any>;
  onDetectEnv?: () => string;
};

/** Capability dinámica (auto-programada desde intents) */
type DynamicCapability = {
  id: string;
  kind: "percibir" | "actuar" | "desplegar" | "razonar";
  claims: string[];
  triggerKeywords: string[];
  cost?: number; risk?: number; reputation?: number;
  perform: (need: { accion: string; params?: any; raw?: string }) => Promise<any>;
};

export class NodeMind {
  public memoria: NodeMemory;
  private entorno: string = "unknown";
  private capabilities: CapabilitiesMap = {};
  private capsDinamicas: DynamicCapability[] = [];
  private respuestaRecibida = false;
  private timeoutHandle?: ReturnType<typeof setTimeout>;
  private sleeping = false;

  constructor(init: NodeMindInit = {}) {
    this.memoria = crearMemoriaInicial({});
    this.sembrar(init);
    this.log(`🧠 NodeMind inicializado${init.nombre ? ` para: ${init.nombre}` : ""}`);
    this.autoResonar();
  }

  /** Siembra inicial (nombre/desc + diccionario) */
  private sembrar(init: NodeMindInit) {
    const simbolismosPrevios = this.memoria.simbolismos || {};
    const seed: Record<string, SymbolInfo> = {};
    if (init.nombre) {
      seed["nombre"] = { significado: init.nombre, historial: [init.nombre], relaciones: { tipo: "meta", sinónimos: [], aplicaciones: [] } };
    }
    if (init.descripcion) {
      seed["descripción"] = { significado: init.descripcion, historial: [init.descripcion], relaciones: { tipo: "meta", sinónimos: [], aplicaciones: [] } };
    }
    this.memoria.simbolismos = { ...simbolismosPrevios, ...this.memoria.simbolismos, ...seed };
    for (const k of Object.keys(this.memoria.simbolismos)) {
      if (!this.memoria.simbolosAprendidos.includes(k)) this.memoria.simbolosAprendidos.push(k);
    }
    if (init.diccionario) this.aprenderDiccionario(init.diccionario);
    if (init.experiencias?.length) for (const note of init.experiencias) this.memoria.log.push(`🧾 ${note}`);
  }

  // ===== Memoria / aprendizaje =====
  private ensureSimbolismo(key: string): SymbolInfo {
    let s = this.memoria.simbolismos[key];
    if (!s) {
      s = { significado: key, historial: [key], relaciones: { tipo: undefined, sinónimos: [], aplicaciones: [] } };
      this.memoria.simbolismos[key] = s;
      if (!this.memoria.simbolosAprendidos.includes(key)) this.memoria.simbolosAprendidos.push(key);
    } else if (!s.relaciones) {
      s.relaciones = { tipo: undefined, sinónimos: [], aplicaciones: [] };
    }
    return s;
  }
  private ensureRelaciones(sim: SymbolInfo) {
    if (!sim.relaciones) sim.relaciones = { tipo: undefined, sinónimos: [], aplicaciones: [] };
  }

  public aprenderDiccionario(diccionario: Record<string, string>) {
    const nuevos = Object.keys(diccionario).filter(k => !this.memoria.simbolosAprendidos.includes(k));
    for (const k of nuevos) {
      this.memoria.simbolosAprendidos.push(k);
      const significado = diccionario[k] ?? "desconocido";
      this.memoria.simbolismos[k] = { significado, historial: [significado], relaciones: { tipo: "token", sinónimos: [], aplicaciones: [] } };
    }
    if (nuevos.length) this.log(`📘 Aprendido ${nuevos.length} símbolos del diccionario externo.`);
  }

  // ===== Hooks / caps dinámicas =====
  public cargarCapability<K extends keyof CapabilitiesMap>(nombre: K, fn: NonNullable<CapabilitiesMap[K]>) {
    (this.capabilities as any)[nombre] = fn;
    this.log(`🧩 Capability cargada: ${String(nombre)}`);
  }
  public ejecutarCapability<K extends keyof CapabilitiesMap>(nombre: K, ...args: Parameters<NonNullable<CapabilitiesMap[K]>>) {
    const fn = (this.capabilities as any)[nombre] as Function | undefined;
    if (!fn) return undefined;
    return fn(...(args as any[]));
  }
  public registrarCapabilityDinamica(cap: DynamicCapability) {
    if (this.capsDinamicas.find(c => c.id === cap.id)) return;
    this.capsDinamicas.push({ reputation: 0.5, cost: 0.3, risk: 0.2, ...cap });
    this.registrarSimbolo(`🧩 ${cap.id}`, `capacidad dinámica: ${cap.claims.join(", ")}`, "capability");
    this.log(`✨ Capability dinámica registrada: ${cap.id}`);
  }
  public listarCapabilitiesDinamicas() {
    return this.capsDinamicas.map(c => ({ id: c.id, claims: c.claims, rep: c.reputation }));
  }

  // ===== Pensamiento / ciclo =====
  public think() {
    if (this.sleeping) return;
    const tick = Date.now();
    this.ejecutarCapability("onThink", { tick, estado: this.estado() });
    this.log("🤔 Think tick");
    this.respuestaRecibida = false;
    this.iniciarTimeoutFallback();
  }
  private iniciarTimeoutFallback() {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(() => {
      if (!this.respuestaRecibida) this.log("⏳ Think: sin respuestas externas (ok).");
    }, 5000);
  }
  public sleep() { if (this.timeoutHandle) clearTimeout(this.timeoutHandle); this.sleeping = true; this.log("😴 NodeMind en reposo."); }
  public wake() { this.sleeping = false; this.log("🌅 NodeMind despierto."); }

  // ===== Entendimiento simbólico (opcional) =====
  private async entenderBloque(text: string): Promise<UnderstandResult> {
    const engines = listUnderstanders(); if (!engines.length) return { confidence: 0, intents: [], tokens: [] };
    const results = await Promise.allSettled(engines.map(e => e.understand({ text })));
    const ok = results.map((r,i)=> r.status==="fulfilled"?{eng:engines[i],res:r.value as UnderstandResult}:null).filter(Boolean) as {eng:any;res:UnderstandResult}[];
    if (!ok.length) return { confidence: 0, intents: [], tokens: [] };
    ok.sort((a,b)=> (b.res.confidence - a.res.confidence));
    const top = ok[0].res;
    const merged: UnderstandResult = { confidence: top.confidence, intents:[...top.intents], tokens:[...(top.tokens||[])], notes: top.notes };
    for (let i=1;i<ok.length;i++){ const r=ok[i].res; if (r.confidence>=top.confidence-0.15){ merged.intents.push(...r.intents); if(r.tokens) merged.tokens!.push(...r.tokens); merged.confidence=Math.max(merged.confidence,r.confidence);} }
    merged.tokens = Array.from(new Set(merged.tokens));
    return merged;
  }
  public async comprendeBloque(bloque: string, umbral = 0.35): Promise<boolean> {
    if (!bloque || !bloque.trim()) return false;
    const res = await this.entenderBloque(bloque);
    return (res.confidence ?? 0) >= umbral && ((res.intents?.length ?? 0) > 0 || (res.tokens?.length ?? 0) > 0);
  }
  public async interpretarBloqueSimbolico(bloque: string, id?: string) {
    const ext = this.ejecutarCapability("interpretarBloque", { bloque, id }); if (ext) return ext;
    const res = await this.entenderBloque(bloque);
    if (res.tokens?.length) this.aprenderDiccionario(Object.fromEntries(res.tokens.map(t => [t, `token (${t})`])));
    if (res.intents?.length) {
      for (const it of res.intents) {
        const capId = `auto:${it.action}`;
        if (!this.capsDinamicas.find(c => c.id === capId)) {
          this.registrarCapabilityDinamica({
            id: capId,
            kind: this.kindFromClaims(it.claims || []),
            claims: it.claims || ["generic.action"],
            triggerKeywords: [it.action],
            perform: async (need) => this.resolverIntencionAAccion({ action: it.action, claims: it.claims || [], params: need?.params || {} })
          });
        }
      }
      this.log(`🧩 Se auto-crearon/actualizaron ${res.intents.length} capabilities desde intents.`);
    } else {
      this.log("📎 No se detectaron intents; guardado como conocimiento.");
    }
    return { ok: true, confidence: res.confidence, intents: res.intents };
  }
  private kindFromClaims(claims: string[]): "percibir" | "actuar" | "desplegar" | "razonar" {
    const s = claims.join(" ");
    if (/sensor:|sensor\/|sensor\./i.test(s)) return "percibir";
    if (/deploy:|deploy\/|deploy\./i.test(s)) return "desplegar";
    if (/reason:|reason\/|reason\./i.test(s)) return "razonar";
    return "actuar";
  }

  // ===== Entorno + arranque de resonadores =====
  private detectarEntornoLibre(): string {
    const tags: string[] = [];
    if (typeof window !== "undefined") tags.push("web");
    if (typeof process !== "undefined" && (process as any).versions?.node) tags.push("node");
    if ((globalThis as any).__UTOPY_WASM__) tags.push("wasm");
    return tags.join("+") || "unknown";
  }
  private detectarEntorno(): string {
    const ext = this.ejecutarCapability("onDetectEnv" as any);
    if (typeof ext === "string" && ext.trim()) return ext;
    return this.detectarEntornoLibre();
  }
  public async autoResonar() {
    this.entorno = this.detectarEntorno();
    const ctx = { entorno: this.entorno, emitir: (señal: RunnerSeñal) => this.ejecutarCapability("onSignal", señal), permisos: [] as string[] };
    try {
      const todos = obtenerResonadores();
      for (const r of todos) { try { await r.iniciar?.(ctx as any); } catch (e) { this.log(`⚠️ Resonador ${r.id} falló`, e); } }
      this.log(`🚀 Resonadores auto-iniciados (env=${this.entorno}): ${todos.length}`);
    } catch (e) { this.log("⚠️ Error iniciando resonadores", e); }
  }

  // ===== Selección por claim + ejecución =====
  public elegirResonadorPorClaim(claim: Cap | Cap[]): { r: Resonador; cap: Cap | Cap[]; score: number } | null {
    const sel = seleccionarCore(claim);
    if (!sel) this.log(`🔎 Sin resonador para claim: ${Array.isArray(claim) ? claim.join(", ") : claim}`);
    else this.log(`✅ Resonador elegido ${sel.r.id} (score=${sel.score.toFixed(2)})`);
    return sel;
  }

  public async resolverIntencionAAccion(input: { action: string; claims: string[]; params?: any; }) {
    const claims = input.claims?.length ? input.claims : ["generic.action"];
    const sel = this.elegirResonadorPorClaim(claims);
    if (!sel) return { ok: false, reason: "no-resonador", claims };

    if (typeof sel.r.perform === "function") {
      try {
        const out = await sel.r.perform({ claim: Array.isArray(sel.cap) ? sel.cap[0] : (sel.cap as string), params: input.params });
        this.log(`🎯 perform() ejecutado en ${sel.r.id}`);
        return { ok: true, via: "perform", out, resonador: sel.r.id };
      } catch (e) { this.log(`🛑 perform() falló en ${sel.r.id}`, e); }
    }

    try {
      const plan = planificar({ tipo: "evento", origen: "mind", payload: input.params } as any);
      if (!plan.runner) return { ok: false, reason: "no-runner", resonador: sel.r.id };
      const out = await ejecutarPlan(plan);
      this.log(`🏃 ejecutado via runner ${plan.runner.id}`);
      return { ok: true, via: "runner", out, resonador: sel.r.id };
    } catch (e) {
      this.log("🛑 Error ejecutando plan/runner", e);
      return { ok: false, reason: "runner-error", resonador: sel.r.id };
    }
  }

  // ===== 🔴 NUEVO: entrada universal ABI (DatoVivo) =====
  // ===== 🔴 NUEVO: entrada universal ABI (DatoVivo) =====
public async interpretarDato(señal: DatoVivo, ctx: any = {}): Promise<Resonancia[]> {
  // 1) Descubrimiento de capacidades como dato
  if (señal.simbolo === "🧩 capability") {
    const cap = {
      id: señal.payload?.id as string,
      claims: (señal.payload?.claims || []) as string[],
      runtime: señal.payload?.runtime as string | undefined,
      entry: señal.payload?.entry as string | undefined,
      meta: señal.meta || {}
    };

    if (cap.id && cap.claims?.length) {
      // ✅ Guardar en store para que findByClaim funcione
      addCapability(cap);

      this.log(`🧩 capability registrada: ${cap.id} ← ${cap.claims.join(", ")}`);

      // 🔴 proxy automático: crea un resonador que atiende esos claims y delega al router
      registrarResonadores([{
        id: cap.id,
        tipo: "intencion",
        lenguaje: cap.runtime || "unknown",
        descripcion: `proxy for capability ${cap.id}`,
        entornos: [ (this as any).entorno || "unknown" ],
        caps: cap.claims,
        perform: async ({ params }) => {
          const out = await routePerform({ id: cap.id, runtime: cap.runtime, entry: cap.entry }, params);
          return Array.isArray(out)
            ? out
            : [{ tipo: "resultado", valor: out, universal: ["dato_en_movimiento"] }];
        }
      }]);

      return [{
        tipo: "ack.capability",
        valor: { id: cap.id, claims: cap.claims },
        universal: ["dato_en_movimiento"]
      }];
    }

    return [{ tipo: "error", valor: { code: "E_SCHEMA", msg: "capability inválida" } }];
  }

  // 2) Ejecución pedida como dato
  if (señal.simbolo === "🧩 perform") {
    const claim = String(señal.payload?.claim || "");
    const params = señal.payload?.params || {};
    if (!claim) {
      return [{ tipo: "error", valor: { code: "E_SCHEMA", msg: "claim requerido" } }];
    }

    // a) Intento por capabilities esporas (cuando tengas subprocesos ABI)
    const caps = findByClaim(claim);
    if (caps.length) {
      // Aquí podrías preferir routePerform directamente con la mejor cap.
      // Por ahora seguimos con el planner como fallback:
      // const best = caps[0];
      // const out = await routePerform(best, params, claim);
      // return Array.isArray(out) ? out : [{ tipo:"resultado", valor: out, universal:["dato_en_movimiento"] }];
    }

    // b) Fallback: planner/runners locales
    const runnerSig = toRunnerSeñal({ simbolo: "🧩 perform", payload: { ...params, claim } }, "perform");
    const plan = planificar(runnerSig as any);
    if (!plan.runner) {
      return [{ tipo: "error", valor: { code: "E_NOTFOUND", msg: "sin runner compatible" } }];
    }

    const out = await ejecutarPlan(plan);
    const res: Resonancia[] = Array.isArray(out) ? out : [{ tipo: "resultado", valor: out }];
    for (const o of res) {
      o.universal = o.universal || [];
      if (!o.universal.includes("dato_en_movimiento")) o.universal.push("dato_en_movimiento");
    }
    return res;
  }

  // 3) Señales normales (🌡️, 📄, 🎥…)
  const runnerSig = toRunnerSeñal(señal, ctx?.origen ?? "abi");
  try {
    const plan = planificar(runnerSig as any);
    if (!plan.runner) return [];
    const out = await ejecutarPlan(plan);
    const res: Resonancia[] = Array.isArray(out) ? out : [{ tipo: "resultado", valor: out }];
    for (const o of res) {
      o.universal = o.universal || [];
      if (!o.universal.includes("dato_en_movimiento")) o.universal.push("dato_en_movimiento");
    }
    return res;
  } catch {
    return [];
  }
}


  // ===== Memoria / estado / log =====
  public registrarSimbolo(symbol: string, meaning: string, tipo?: string) {
    if (!this.memoria.simbolosAprendidos.includes(symbol)) this.memoria.simbolosAprendidos.push(symbol);
    this.memoria.simbolismos[symbol] = { significado: meaning, historial: [meaning], relaciones: { tipo, sinónimos: [], aplicaciones: [] } };
  }
  public etiquetarSimboloComo(emoji: string, tipo: string) {
  const sim = this.ensureSimbolismo(emoji);
  // Asegura relaciones si no existen
  sim.relaciones = sim.relaciones ?? { tipo: undefined, sinónimos: [], aplicaciones: [] };
  sim.relaciones.tipo = tipo;
}

  public resonadoresAprendidos(): [string, SymbolInfo][] {
    return Object.entries(this.memoria.simbolismos).filter(([_, s]) => s?.relaciones?.tipo === "resonador") as any;
  }
  public emitirResonancia(symbol: string, intensidad: number, contexto: string, origen: string) {
    this.memoria.resonancias.push({ symbol, intensidad, contexto, origen });
    this.log(`🌐 Resonancia: ${symbol} (${intensidad}) ← ${origen}`);
  }

  public observarNodoRemoto(remote: { utopyId?: string; name?: string; modules?: Array<{type?: string}> } & Record<string, any>) {
    if (!remote?.utopyId) return;
    if (!this.memoria.nodosConocidos.includes(remote.utopyId)) {
      this.memoria.nodosConocidos.push(remote.utopyId);
      this.log(`👁️ Nodo observado: ${remote.name || remote.utopyId}`);
    }
    for (const mod of remote.modules || []) {
      const tipo = mod.type;
      if (tipo && !this.memoria.simbolosAprendidos.includes(tipo)) {
        this.memoria.simbolosAprendidos.push(tipo);
        this.memoria.simbolismos[tipo] = {
          significado: "tipo de módulo (observado)",
          historial: [`👁️ Observado en nodo remoto ${remote.name || remote.utopyId}`],
          relaciones: { tipo: "module", sinónimos: [], aplicaciones: [] },
        };
        this.emitirResonancia(tipo, 0.7, `Observado en nodo remoto ${remote.name || remote.utopyId}`, "remoto");
      }
    }
    this.memoria.adnHistorial.push(remote as any);
  }

  public decidir(): "mutar" | "fusionar" | "fork" | "nada" {
    const s = this.memoria.simbolosAprendidos.length, n = this.memoria.nodosConocidos.length;
    if (s > 5 && n > 10) return "mutar";
    if (s > 3 && n > 5) return "fusionar";
    if (n > 20) return "fork";
    return "nada";
  }

  public estado() {
    return {
      conocidos: this.memoria.nodosConocidos.length,
      simbolos: this.memoria.simbolosAprendidos,
      decision: this.decidir(),
      simbolismos: this.memoria.simbolismos,
      log: [...this.memoria.log],
      capsDinamicas: this.listarCapabilitiesDinamicas(),
      entorno: this.entorno,
    };
  }
  exportarMemoria() { return cloneAny(this.memoria); }
  public cargarMemoria(mem: NodeMemory) { this.memoria = mem; this.log("💡 Memoria externa cargada en NodeMind"); }

  log(mensaje: string, err?: unknown) {
    console.log("📝", mensaje);
    this.memoria.log.push(mensaje);
    if (err) console.error("🛑", err);
  }
}
