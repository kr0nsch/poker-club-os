// `node dist/cli.js migrate|seed` — used by `pnpm db:migrate` and container entrypoints.
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedSystemRoles } from "./seed-system.js";

const command = process.argv[2] ?? "migrate";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

const handle = createDb(url, { max: 2, applicationName: "pcos-migrate" });
try {
  if (command === "migrate" || command === "seed") {
    await runMigrations(handle);
    await seedSystemRoles(handle.db);
    console.log("[db] migrations applied, system roles seeded");
  } else {
    console.error(`unknown command ${command}`);
    process.exitCode = 2;
  }
} finally {
  await handle.close();
}
