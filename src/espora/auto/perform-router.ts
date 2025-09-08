import { spawn } from "node:child_process";

type LocalMap = Map<string, (params:any)=>Promise<any>|any>;
const LOCAL_PERFORMS: LocalMap = new Map();

export function registerLocalPerform(id: string, fn: (params:any)=>Promise<any>|any) {
  LOCAL_PERFORMS.set(id, fn);
}

/** Ejecuta según runtime/entry o función local registrada. */
export async function routePerform(
  cap: { id: string; runtime?: string; entry?: string },
  params: any,
  claim?: string
): Promise<any> {
  // 1) local TS
  if ((cap.runtime?.toLowerCase() === "typescript" && cap.entry?.startsWith("local:")) || LOCAL_PERFORMS.has(cap.id)) {
    const fn = LOCAL_PERFORMS.get(cap.id);
    if (!fn) throw new Error(`LOCAL_PERFORM not found for ${cap.id}`);
    return await fn(params);
  }
  // 2) subproceso (python/bash/lo que sea)
  if (cap.entry) return await execJsonProcess(cap.entry, { claim, params });
  throw new Error(`No execution path for capability ${cap.id}`);
}

function execJsonProcess(entry: string, input: any, timeoutMs = 20000): Promise<any> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = entry.split(" ").filter(Boolean);
    const child = spawn(cmd, args, { stdio: ["pipe","pipe","pipe"] });

    let stdout = "", stderr = "", done = false;
    const to = setTimeout(() => { if (!done){ done = true; try{child.kill("SIGKILL");}catch{}; reject(new Error("E_TIMEOUT")); } }, timeoutMs);

    child.stdout.setEncoding("utf8"); child.stdout.on("data", (c)=> stdout += String(c));
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (c)=> stderr += String(c));
    child.on("error", (err)=>{ if(done) return; done=true; clearTimeout(to); reject(err); });
    child.on("close", ()=> {
      if(done) return; done = true; clearTimeout(to);
      if (!stdout.trim()) return resolve([]);
      try { resolve(JSON.parse(stdout)); }
      catch (e) {
        const lines = stdout.trim().split(/\r?\n/);
        try { resolve(JSON.parse(lines[lines.length-1])); }
        catch { reject(new Error(`E_PARSE: ${String(e)} | stderr=${stderr}`)); }
      }
    });

    try { child.stdin.write(JSON.stringify(input)+"\n"); child.stdin.end(); }
    catch (e) { if(!done){ done=true; clearTimeout(to); reject(e);} }
  });
}
