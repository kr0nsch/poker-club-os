// Venue Edge Server — API process (REST + local WebSocket).

import "reflect-metadata";
import { createCore, loadConfig } from "@pcos/core";
import { runMigrations, seedSystemRoles } from "@pcos/db";
import { createApiServer } from "./server.js";

const config = loadConfig();
const core = createCore(config, { applicationName: "pcos-api" });

if (config.AUTO_MIGRATE) {
  await runMigrations(core.handle);
  await seedSystemRoles(core.db);
}

const setupToken = await core.auth.ensureSetupToken();
if (setupToken) {
  const line = "=".repeat(64);
  console.log(`\n${line}\n  FIRST-RUN SETUP\n  Open the web app and complete setup with this one-time token:\n\n      ${setupToken}\n\n  (The token is only shown here on the edge server console.)\n${line}\n`);
}
await core.edge.ensureNode();

const server = await createApiServer(core);
console.log(`[api] edge node ${config.EDGE_NODE_ID} listening on port ${config.PORT} (${config.NODE_ENV})`);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`[api] ${signal} received, shutting down gracefully`);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  try {
    await server.close();
    await core.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (e) => console.error("[api] unhandled rejection:", e));
