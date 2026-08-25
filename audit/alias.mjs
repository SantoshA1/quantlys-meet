// The loader that lets a Maya suite import a REAL Next.js route handler.
//
// Maya's first invariant is black-box through the real API: drive the route
// the user actually hits, fake only the cloud. Next resolves "@/lib/x" through
// tsconfig paths, which plain node does not read, so without this the only
// testable thing would be the pure helpers — and the pure helpers are not
// where route bugs live.
//
// Two jobs, both narrow:
//   1. "@/lib/model" -> <repo>/lib/model.ts (node needs the extension)
//   2. "@supabase/supabase-js" -> the fake cloud, so no suite can touch a
//      real project even by accident.
//
// Node's own type-stripping does the TypeScript. Nothing here transforms code.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const ROOT = pathToFileURL(process.cwd() + "/").href;
const FAKES = {
  "@supabase/supabase-js": new URL("./fake-cloud.mjs", import.meta.url).href,
};

export async function resolve(spec, ctx, next) {
  if (FAKES[spec]) return { url: FAKES[spec], shortCircuit: true };
  if (spec.startsWith("@/")) {
    const base = new URL(spec.slice(2), ROOT);
    for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
      const u = new URL(base.href + ext);
      if (existsSync(u)) return next(u.href, ctx);
    }
    return next(base.href, ctx);
  }
  return next(spec, ctx);
}
