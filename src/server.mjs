import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import pg from "pg";

for (const file of [".env", ".env.local"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Run neon deploy to pull it.");
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
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  try {
    const { rows } = await database.query("SELECT 1 AS result");
    response.writeHead(200, headers).end(JSON.stringify({ postgres: rows[0].result }));
  } catch (error) {
    console.error("PostgreSQL health query failed", error.code ?? error.name);
    response.writeHead(503, headers).end(JSON.stringify({ postgres: "unavailable" }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log(`Listening at http://127.0.0.1:${server.address().port}`);
});
