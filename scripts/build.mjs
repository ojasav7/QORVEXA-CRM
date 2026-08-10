// Cross-platform build: runs the typecheck, then Vite build.
// (Plain npm scripts with && break when npm's script-shell is PowerShell.)
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  // Windows resolves `npx` only through its .cmd shim, which needs a shell
  // (spawnSync shell:false throws ENOENT). POSIX npx is a real binary.
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["tsc", "--noEmit"]);
run("npx", ["vite", "build"]);
console.log("\n✓ Build complete — dist/ is ready to be served by Express.");
