// Venue Edge Server — worker process.

import { createCore, loadConfig, startWorkerLoops } from "@pcos/core";
import { runMigrations, seedSystemRoles } from "@pcos/db";

const config = loadConfig();
const core = createCore(config, { applicationName: "pcos-worker", poolSize: 10 });

if (config.AUTO_MIGRATE) {
  await runMigrations(core.handle);
  await seedSystemRoles(core.db);
}
await core.edge.ensureNode();

const worker = await startWorkerLoops(core);
console.log(`[worker] edge node ${config.EDGE_NODE_ID} started (telegram ${config.TELEGRAM_ENABLED ? "enabled" : "per organization"}, cloud sync ${core.sync.enabled ? "enabled" : "disabled"})`);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`[worker] ${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  try {
    await worker.stop();
    await core.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection:", e));
