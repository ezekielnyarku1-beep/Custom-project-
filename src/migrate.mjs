import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import pg from "pg";

for (const path of [".env", ".env.local"])
  if (existsSync(path)) loadEnvFile(path);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(620943719)");
  for (const [file, table] of [
    ["001_overview", "projects"],
    ["002_workspace", "accounts"],
    ["003_task_details", "saved_views"],
  ]) {
    const {
      rows: [state],
    } = await client.query("SELECT to_regclass($1) present", [table]);
    if (!state.present)
      await client.query(
        await readFile(
          new URL("../migrations/" + file + ".sql", import.meta.url),
          "utf8",
        ),
      );
  }
} finally {
  await client.end();
}
