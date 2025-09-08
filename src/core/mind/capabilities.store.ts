type CapRecord = {
  id: string;
  claims: string[];
  runtime?: string;
  entry?: string;
  meta?: Record<string, any>;
};

const CAPS: CapRecord[] = [];

/** Agrega o reemplaza por id */
export function addCapability(cap: CapRecord) {
  const idx = CAPS.findIndex(c => c.id === cap.id);
  if (idx >= 0) CAPS[idx] = cap;
  else CAPS.push(cap);
}

/** Devuelve todas las capabilities conocidas */
export function listCapabilities(): CapRecord[] {
  return [...CAPS];
}

/** Busca por claim (prefijo jerárquico simple) */
export function findByClaim(claim: string): CapRecord[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(claim);
  return CAPS.filter(c =>
    (c.claims || []).some(raw => {
      const offered = norm(raw);
      if (offered === target) return true;
      // prefijo jerárquico: sensor://temp ≈ sensor://temp/room1
      return target.startsWith(offered.endsWith("/") ? offered : offered + "/");
    })
  );
}
