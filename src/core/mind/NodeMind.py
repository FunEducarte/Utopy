#!/usr/bin/env python3
# NotMine.py — Mente simbiótica externa (understander + memoria)
# Compatible con el protocolo JSON line-based:
# { "type": "<cmd>", "payload": {...}, "id": "<opcional>" }

import json
import sys
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

# ------------------------------
# Utilidades I/O (JSONL robusto)
# ------------------------------

def _emit(kind: str, payload: Any, msg_id: Optional[str] = None):
    msg = {"type": kind, "payload": payload}
    if msg_id:
        msg["id"] = msg_id
    print(json.dumps(msg), flush=True)

def _ok(payload: Any, msg_id: Optional[str] = None):
    _emit("respuesta", payload, msg_id)

def _sug(payload: Any, msg_id: Optional[str] = None):
    _emit("sugerencia", payload, msg_id)

def _logln(txt: str):
    # Logs son líneas simples (no JSON) para no romper el protocolo
    print(txt, flush=True)

# ------------------------------
# Mente
# ------------------------------

class NodeMind:
    def __init__(self):
        # memoria simbólica enriquecida
        # symbol -> {
        #   "significado": str,
        #   "relaciones": { "sinónimos": [], "aplicaciones": [], "tipo": str|None },
        #   "historial": [str, ...]
        # }
        self.memory: Dict[str, Dict[str, Any]] = {}
        self.logs: List[str] = []

    # --------- ciclo de vida ---------

    def think(self):
        self._log("🧠 NodeMind activo. Lista para razonar.")

    def sleep(self):
        self._log("😴 Entrando en modo reposo.")

    # --------- conocimiento ---------

    def learn(self, symbol: str, meaning: str):
        if not symbol:
            return
        if symbol not in self.memory:
            self.memory[symbol] = {
                "significado": meaning,
                "relaciones": {"sinónimos": [], "aplicaciones": [], "tipo": None},
                "historial": []
            }
        else:
            self.memory[symbol]["significado"] = meaning

        self.memory[symbol]["historial"].append(meaning)
        self._log(f"📚 Aprendido: {symbol} = {meaning}")

        similares = self._buscar_similares(symbol, meaning)
        if similares:
            _ok(f"{symbol} podría estar relacionado con {similares}")

    def explain(self, symbol: str, msg_id: Optional[str] = None):
        if symbol in self.memory:
            significado = self.memory[symbol]["significado"]
            tipo = self.memory[symbol]["relaciones"].get("tipo")
            detalle = f"{symbol} significa: {significado}"
            if tipo:
                detalle += f" (tipo: {tipo})"
            _ok(detalle, msg_id)
        else:
            _ok(f"No conozco el símbolo: {symbol}", msg_id)

    def interpret_resonance(self, symbol: str, intensidad: float, contexto: str, msg_id: Optional[str] = None):
        self._log(f"🌐 Resonancia: {symbol} (intensidad={intensidad}) en '{contexto}'")
        if symbol in self.memory:
            significado = self.memory[symbol]["significado"]
            emergente = self._crear_simbolo_emergente(symbol, significado, contexto, intensidad)
            _ok(f"Nueva idea simbiótica: {emergente}", msg_id)
        else:
            _ok(f"No conozco el símbolo resonante: {symbol}", msg_id)

    def suggest(self, symbol: str, msg_id: Optional[str] = None):
        similares = []
        for sym, data in self.memory.items():
            if sym == symbol:
                continue
            simil = SequenceMatcher(None, symbol, sym).ratio()
            if simil > 0.6:
                similares.append((sym, data["significado"]))
        if similares:
            sug_sym, sug_mean = similares[0]
            suggestion = {
                "base": symbol,
                "relacionado": sug_sym,
                "meaning": sug_mean,
                "accion": "fusionar_con"
            }
            _sug(suggestion, msg_id)
        else:
            self._log(f"ℹ️ Sin sugerencias para {symbol}")

    def aplicar_reglas(self):
        for simbolo, data in self.memory.items():
            relaciones = data.get("relaciones", {})
            if relaciones.get("tipo") == "meta":
                self._log(f"ℹ️ {simbolo} es meta")

    def fusionar_memoria(self, memoria_remota: dict):
        self._log("🔗 Fusionando memoria remota…")
        for simbolo, data_remota in memoria_remota.items():
            if simbolo not in self.memory:
                self.memory[simbolo] = data_remota
                self._log(f"🧬 Importado símbolo nuevo: {simbolo}")
            else:
                local = self.memory[simbolo]
                if data_remota.get("significado") and data_remota["significado"] not in local["historial"]:
                    local["historial"].append(data_remota["significado"])
                for campo in ["sinónimos", "aplicaciones"]:
                    remotos = set(data_remota.get("relaciones", {}).get(campo, []))
                    locales = set(local.get("relaciones", {}).get(campo, []))
                    local["relaciones"][campo] = list(remotos.union(locales))
                if not local["relaciones"].get("tipo") and data_remota.get("relaciones", {}).get("tipo"):
                    local["relaciones"]["tipo"] = data_remota["relaciones"]["tipo"]
        self._log("✅ Memoria fusionada.")

    # --------- bloques simbólicos / DSL libre ---------

    def comprende_bloque(self, emoji: str) -> bool:
        return emoji in self.memory

    def interpretar_bloque_simbolico(self, symbol: str, payload: str):
        sdata = self.memory.get(symbol)
        if not sdata:
            return None
        tipo = sdata["relaciones"].get("tipo")
        if tipo == "sensor":
            return {"key": "modules", "value": {"type": "sensor", "config": (payload or "").strip()}}
        if tipo == "meta":
            return {"key": "metadata", "value": (payload or "").strip()}
        return {"key": "custom", "value": (payload or "").strip()}

    def obtener_definicion_bloque(self, bloque: str):
        return self.memory.get(bloque)

    # --------- UNDERSTAND (para orquestador externo) ---------

    def understand_text(self, text: str) -> dict:
        """
        Devuelve: { confidence: float, intents: [{action, claims}], tokens: [str] }
        Heurística simple; podés hacerla tan potente como quieras.
        """
        t = (text or "").lower()
        intents: List[dict] = []

        def add(action: str, claims: List[str]):
            intents.append({"action": action, "claims": claims})

        # Intenciones multi-idioma (seed)
        if re.search(r"\b(deploy|despleg|publicar|publish)\b", t):
            add("deploy", ["deploy.web"])
        if re.search(r"\b(connect|conectar|vincular)\b", t):
            add("connect", ["connect.generic"])
        if re.search(r"\b(scan|qr|escanear|escanea)\b", t):
            add("scan", ["sensor.qr"])
        if re.search(r"\b(learn|aprender|aprende)\b", t):
            add("learn", ["reason.learn"])
        if re.search(r"\b(analyze|analizar|analiza)\b", t):
            add("analyze", ["reason.analyze"])
        if re.search(r"\b(run|execute|ejecutar|ejecuta)\b", t):
            add("run", ["exec.generic"])

        # Pistas de ecosistema (sumá las que quieras)
        if "evm" in t or "ethereum" in t:
            add("connect", ["connect.evm"])
        if "ipfs" in t:
            add("deploy", ["ipfs.pin"])
        if "wasm" in t:
            add("deploy", ["deploy.wasm"])
        if "qr" in t:
            add("scan", ["sensor.qr"])
        if "sensor" in t:
            add("sense", ["sensor.any"])

        # Tokens para aprendizaje lingüístico del orquestador
        tokens = sorted(set(re.findall(r"[#@]?\w[\w\-\._:]*", t)))

        # Confianza (ajustá a gusto)
        confidence = min(1.0, 0.2 + 0.2*len(intents) + (0.1 if tokens else 0))
        return {"confidence": confidence, "intents": intents, "tokens": tokens}

    # --------- protocolo ---------

    def receive(self, json_message: str):
        try:
            message = json.loads(json_message)
            type_ = message.get("type")
            payload = message.get("payload")
            msg_id = message.get("id")

            if type_ == "symbol":
                self.learn(payload.get("symbol"), payload.get("meaning"))
                _ok(f"Símbolo aprendido: {payload.get('symbol')}", msg_id)

            elif type_ == "explain":
                self.explain(payload.get("symbol"), msg_id)

            elif type_ == "resonance":
                self.interpret_resonance(
                    payload.get("symbol"),
                    float(payload.get("intensidad", 0.5)),
                    payload.get("contexto", ""),
                    msg_id
                )

            elif type_ == "suggest":
                self.suggest(payload.get("symbol"), msg_id)

            elif type_ == "rules":
                self.aplicar_reglas()

            elif type_ == "fusionar_memoria":
                self.fusionar_memoria(payload or {})

            elif type_ == "interpretar_bloque":
                symbol = (payload or {}).get("symbol")
                contenido = (payload or {}).get("payload", "")
                interpretado = self.interpretar_bloque_simbolico(symbol, contenido)
                _ok(interpretado, msg_id)

            # 🚀 NUEVO: endpoint understand (understander externo)
            elif type_ == "understand":
                text = (payload or {}).get("text", "")
                res = self.understand_text(text)
                _ok(res, msg_id)

            elif type_ == "exit":
                self.sleep()
                sys.exit(0)

            else:
                self._log(f"❌ Tipo de mensaje desconocido: {type_}")

        except Exception as e:
            self._log(f"⚠️ Error al procesar mensaje: {e}")

    # --------- helpers ---------

    def _buscar_similares(self, nuevo_symbol: str, nuevo_meaning: str):
        similares = []
        for symbol, data in self.memory.items():
            if symbol == nuevo_symbol:
                continue
            meaning = data.get("significado", "")
            if not meaning:
                continue
            simil = SequenceMatcher(None, meaning, nuevo_meaning or "").ratio()
            if simil > 0.5:
                similares.append(f"{symbol} ({meaning})")
        return ", ".join(similares) if similares else None

    def _crear_simbolo_emergente(self, symbol: str, meaning: str, contexto: str, intensidad: float):
        combinacion = f"{meaning} @ {contexto} (intensidad {intensidad})"
        return f"{symbol}* ({combinacion})"

    def _log(self, msg: str):
        _logln(msg)
        self.logs.append(msg)

# ------------------------------
# Main loop
# ------------------------------

if __name__ == "__main__":
    mind = NodeMind()
    mind.think()
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            if line.lower() in ("exit", "quit"):
                mind.sleep()
                break
            mind.receive(line)
        except KeyboardInterrupt:
            mind.sleep()
            break
        except Exception as e:
            _logln(f"⚠️ Loop error: {e}")
