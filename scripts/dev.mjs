// One-command development environment:
//   pnpm dev
// 1. creates .env with random secrets on first run,
// 2. starts the embedded PostgreSQL,
// 3. builds the shared packages,
// 4. runs API, worker (with file watching) and the Next.js web app.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDevDb } from "./dev-db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
const isWin = process.platform === "win32";

if (!existsSync(envFile)) {
  const template = readFileSync(path.join(root, ".env.example"), "utf8");
  const values = {
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54320/pcos",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    APP_URL: "",
    LOCAL_APP_URL: "http://localhost:3000",
    ALLOWED_ORIGINS: "http://localhost:3000",
    COOKIE_SECURE: "false",
    EDGE_NODE_ID: "edge-dev",
    NODE_ENV: "development",
    // Known up front so `pnpm seed:demo` can run the first-run setup (never reuse it in production).
    SETUP_TOKEN: randomBytes(16).toString("hex"),
    // Absolute: API and worker run from their own package folders but must share files and backups.
    STORAGE_DIR: path.join(root, ".data", "files").replaceAll("\\", "/"),
    BACKUP_DIR: path.join(root, ".data", "backups").replaceAll("\\", "/"),
  };
  let out = template;
  for (const [k, v] of Object.entries(values)) out = out.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`);
  writeFileSync(envFile, out);
  console.log("[dev] created .env with fresh development secrets");
}

const db = await startDevDb();

console.log("[dev] building shared packages …");
const build = spawnSync(isWin ? "pnpm.exe" : "pnpm", ["turbo", "run", "build", "--filter=./packages/*", "--filter=@pcos/api", "--filter=@pcos/worker", "--output-logs=errors-only"], {
  cwd: root,
  stdio: "inherit",
  shell: isWin,
});
if (build.status !== 0) {
  await db.stop();
  process.exit(build.status ?? 1);
}

const children = [];
function run(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: isWin, env: { ...process.env, FORCE_COLOR: "1" } });
  const prefix = `[${name}]`.padEnd(9);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (d) => {
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) console.log(`${prefix} ${line}`);
    });
  }
  child.on("exit", (code) => console.log(`${prefix} exited with ${code}`));
  children.push(child);
}

const node = process.execPath;
const envArg = `--env-file=${envFile}`;
run("tsc", isWin ? "pnpm.exe" : "pnpm", ["turbo", "run", "dev", "--filter=./packages/*", "--output-logs=errors-only"], root);
run("api", node, [envArg, "--watch-path=dist", "--watch-path=../../packages/core/dist", "dist/main.js"], path.join(root, "apps/api"));
run("worker", node, [envArg, "--watch-path=dist", "--watch-path=../../packages/core/dist", "dist/main.js"], path.join(root, "apps/worker"));
if (existsSync(path.join(root, "apps/web/package.json"))) run("web", isWin ? "pnpm.exe" : "pnpm", ["--filter", "@pcos/web", "dev"], root);

async function shutdown() {
  for (const c of children) c.kill("SIGTERM");
  await db.stop().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
