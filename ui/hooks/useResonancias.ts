import { useEffect, useState } from "react";
import type { Resonancia } from "../../src/core/types/core";

export function useResonancias() {
  const [res, setRes] = useState<Resonancia[]>([]);
  useEffect(() => {
    function onRes(e: any) {
      const arr = e.detail as Resonancia[];
      setRes(prev => [...prev, ...arr]);
    }
    window.addEventListener("dv:res", onRes as any);
    return () => window.removeEventListener("dv:res", onRes as any);
  }, []);
  return res;
}
