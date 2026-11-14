import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const sourceRoot = new URL("../src/", import.meta.url);
// Local maintenance CLI only. Reuse server validation without starting Next.js.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    let candidate;
    if (specifier.startsWith("@/")) candidate = new URL(specifier.slice(2), sourceRoot);
    else if (specifier.startsWith(".") && context.parentURL?.startsWith(sourceRoot.href))
      candidate = new URL(specifier, context.parentURL);
    if (candidate) {
      if (existsSync(fileURLToPath(candidate)) && candidate.pathname.endsWith(".json"))
        return { url: candidate.href, shortCircuit: true };
      if (existsSync(fileURLToPath(candidate) + ".ts"))
        return { url: pathToFileURL(fileURLToPath(candidate) + ".ts").href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot.href) && url.endsWith(".json"))
      return {
        format: "module",
        source: `export default ${readFileSync(new URL(url), "utf8")}`,
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
