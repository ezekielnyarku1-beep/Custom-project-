import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import pg from "pg";
import { api, fail } from "./api.mjs";

for (const file of [".env", ".env.local"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const database = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 10_000,
  query_timeout: 10_000,
  enableChannelBinding: true,
});
database.on("error", (error) => {
  console.error("Idle PostgreSQL connection failed", error.code ?? error.name);
});

const server = createServer(async (request, response) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const send = (status, data) => response.writeHead(status, headers).end(JSON.stringify(data));
  let client;
  let health = false;
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    health = request.method === "GET" && path === "/health";
    if (health) {
      const { rows } = await database.query("SELECT 1 AS result");
      return send(200, { postgres: rows[0].result });
    }
    if (!path.startsWith("/api/")) fail(404, "Route not found");
    client = await database.connect();
    await client.query("BEGIN");
    const result = await api(client, request, path);
    await client.query("COMMIT");
    send(...result);
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch {
        client.release(true);
        client = null;
      }
    }
    if (health) return send(503, { postgres: "unavailable" });
    if (error.status) return send(error.status, { error: error.message });
    if (/^2[23][0-9A-Z]{3}$/.test(error.code ?? "")) return send(400, { error: "Invalid data for this operation" });
    send(500, { error: "The request could not be completed" });
  } finally {
    client?.release();
  }
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log(`Listening at http://127.0.0.1:${server.address().port}`);
});
