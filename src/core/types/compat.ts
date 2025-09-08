    // src/core/types/compat.ts
    import type { DatoVivo } from "../types/core"; // tu tipo real actual, si existe

    export type SymbolKind = "sensor" | "actuator" | "semantic" | "other";

    // Bloque simbólico mínimo (para diccionarios/interpretadores viejos)
    export interface SymbolicBlock {
    simbolo: string;
    kind?: SymbolKind;
    interpret?: (dv: DatoVivo | any) => any;
    [k: string]: any;
    }

    // Conjunto de bloques por símbolo
    export type SymbolicDictionary = Record<string, SymbolicBlock>;

    // Tipos legacy usados por utils y parser antiguos
    export interface Module { name?: string; [k: string]: any; }
    export interface Action { method?: string; [k: string]: any; }

    // “ADN” legacy: sólo lo que necesitan utils/merge y otros
    export interface ADN {
    modules?: Module[];
    actions?: Action[];
    [k: string]: any;
    }

    // Algunos códigos importaban esto:
export type BlockInterpreterEnriched = SymbolicBlock;
