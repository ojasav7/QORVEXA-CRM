// Cross-platform build: typechecks the CRM, builds the CRM SPA (vite base
// /app/ → dist/), then builds the landing page (qorvexacrm/ → landing/) that
// Express serves at the site root. One URL, one stack (docs/54-spec-phase16.md).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const landingApp = path.join(root, "qorvexacrm");
const landingDist = path.join(landingApp, "dist");
const landingOut = path.join(root, "landing");

function run(cmd, args, cwd) {
  // Windows resolves `npx` only through its .cmd shim, which needs a shell
  // (spawnSync shell:false throws ENOENT). POSIX npx is a real binary.
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", cwd });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1. CRM typecheck + SPA build (dist/ — mounted by Express at /app).
run("npx", ["tsc", "--noEmit"], root);
run("npx", ["vite", "build"], root);

// 2. Landing page build (qorvexacrm → landing/, served at the site root).
run("npm", ["run", "build"], landingApp);
fs.rmSync(landingOut, { recursive: true, force: true });
fs.cpSync(landingDist, landingOut, { recursive: true });
console.log(`\n✓ Landing page copied to ${path.relative(root, landingOut)}/ — served at the site root.`);

console.log("\n✓ Build complete — dist/ (CRM app at /app) + landing/ (site root) ready for Express.");
