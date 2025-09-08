// runtime/lib/auth.js

/** Env:
 *  UTOPY_TOKENS='tokenA:scope1,scope2;tokenB:*'
 */
function parseTokens() {
  const src = process.env.UTOPY_TOKENS || "";
  const map = new Map();
  for (const part of src.split(";").map(s => s.trim()).filter(Boolean)) {
    const [tok, scopesStr] = part.split(":");
    const scopes = (scopesStr || "").split(",").map(s => s.trim()).filter(Boolean);
    map.set(tok, new Set(scopes.length ? scopes : ["*"]));
  }
  return map;
}
const TOKENS = parseTokens();

export function authorize(ctx = {}, required = []) {
  // si no hay tokens configurados → permitir (modo dev)
  if (TOKENS.size === 0) return { ok: true };

  const bearer = ctx?.auth?.bearer || ctx?.auth?.token;
  if (!bearer) return { ok: false, reason: "NO_TOKEN" };

  const scopes = TOKENS.get(bearer);
  if (!scopes) return { ok: false, reason: "BAD_TOKEN" };

  if (scopes.has("*") || required.length === 0) return { ok: true };
  const need = new Set(required);
  for (const s of scopes) need.delete(s);
  return need.size === 0 ? { ok: true } : { ok: false, reason: "MISSING_SCOPES", missing: [...need] };
}
