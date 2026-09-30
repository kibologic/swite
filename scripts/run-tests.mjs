// Runs every __tests__/*.test.ts with node's test runner (Node 18 has no glob support,
// and `npm test` on Windows does not expand one).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(path.join(root, "__tests__"))
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join("__tests__", f));

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
