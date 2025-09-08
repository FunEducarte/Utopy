// resonador.embed.js
import init, { main as wasmMain } from "./wasm-build/resonador_wasm.js"; // WASM simbiótico
import { Utopy } from "./dist/index.mjs"; // Motor vivo de UTOPÝ

// 🔍 Intenta encontrar archivos .utopy en la página actual (modo web)
async function buscarTodosLosUtopy() {
  try {
    const html = await fetch(".").then(r => r.text());
    const archivos = [...html.matchAll(/href="([^"]+\.utopy)"/g)].map(m => m[1]);
    return archivos;
  } catch (err) {
    console.error("❌ Error al escanear archivos .utopy:", err);
    return [];
  }
}

// 📄 Manifiesto específico: manifiesto.utopy (si se desea priorizar uno)
async function leerManifiesto() {
  try {
    const res = await fetch("manifiesto.utopy");
    if (res.ok) {
      const texto = await res.text();
      console.log("📄 Detectado: manifiesto.utopy");
      await Utopy.live(texto);
      return true;
    }
  } catch {
    /* ignorar error si no existe */
  }
  return false;
}

// 🌀 Inicia el resonador simbiótico
async function iniciarResonador() {
  console.log("🧬 Iniciando resonador simbiótico universal...");

  try {
    await init();
    wasmMain(); // Log simbiótico del WASM
  } catch (err) {
    console.warn("⚠️ WASM falló o no fue cargado:", err);
  }

  // 1️⃣ Intentar primero con manifiesto.utopy
  const manifestoDetectado = await leerManifiesto();
  if (manifestoDetectado) return;

  // 2️⃣ Si no hay manifiesto, buscar todos los .utopy
  const archivos = await buscarTodosLosUtopy();
  if (archivos.length === 0) {
    console.log("📭 No se encontraron archivos .utopy en la carpeta web");
    return;
  }

  for (const archivo of archivos) {
    const texto = await fetch(archivo).then(r => r.text());
    console.log(`📄 Detectado archivo: ${archivo}`);
    await Utopy.live(texto);
  }
}

// 🚀 Auto-invoca
iniciarResonador();
