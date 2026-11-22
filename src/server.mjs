import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { loadEnvFile } from "node:process";
import pg from "pg";
import { accountApi, identity, startMailer } from "./accounts.mjs";
import { workspaceApi } from "./workspace.mjs";
import { api, fail } from "./api.mjs";

for (const file of [".env", ".env.local"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const connectionString = process.env.DATABASE_URL;
const clientRoot = resolve("client");
const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

const database = new pg.Pool({
  connectionString,
  connectionTimeoutMillis: 10_000,
  query_timeout: 10_000,
  enableChannelBinding: true,
});
database.on("error", (error) => {
  console.error("Idle PostgreSQL connection failed", error.code ?? error.name);
});

if (!process.env.VERCEL) startMailer(database);
const attempts = new Map();
setInterval(() => {
  for (const [ip, bucket] of attempts)
    if (bucket.until < Date.now()) attempts.delete(ip);
}, 60000).unref();
export async function handleRequest(request, response) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const send = (status, data, extra = {}) =>
    response
      .writeHead(status, { ...headers, ...extra })
      .end(JSON.stringify(data));
  let client;
  let health = false;
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (
      request.method === "GET" &&
      !path.startsWith("/api/") &&
      path !== "/health"
    ) {
      const file = resolve(
        clientRoot,
        path === "/" ? "index.html" : path.slice(1),
      );
      const type = contentTypes[extname(file)];
      if (
        !["index.html", "app.js", "src/styles.css", "src/validate.js"].some(
          (asset) => resolve(clientRoot, asset) === file,
        ) ||
        !type
      )
        fail(404, "File not found");
      let contents;
      try {
        contents = await readFile(file);
      } catch {
        fail(404, "File not found");
      }
      response
        .writeHead(200, {
          "Content-Type": type + "; charset=utf-8",
          "Cache-Control": "no-cache",
        })
        .end(contents);
      return;
    }
    health = request.method === "GET" && path === "/health";
    if (!connectionString) fail(503, "The server is missing DATABASE_URL");
    if (health) {
      const { rows } = await database.query("SELECT 1 AS result");
      return send(200, { postgres: rows[0].result });
    }
    if (!path.startsWith("/api/")) fail(404, "Route not found");
    if (
      !["GET", "HEAD"].includes(request.method) &&
      (request.headers["sec-fetch-site"] === "cross-site" ||
        !request.headers["content-type"]?.startsWith("application/json"))
    )
      fail(403, "Expected a same-origin JSON request");
    if (
      ["login", "signup", "forgot-password", "reset-password"].some(
        (action) => path === "/api/auth/" + action,
      )
    ) {
      const key = request.socket.remoteAddress;
      let bucket = attempts.get(key);
      if (!bucket || bucket.until < Date.now())
        attempts.set(key, (bucket = { count: 0, until: Date.now() + 60000 }));
      if (++bucket.count > 35)
        fail(429, "Too many attempts. Try again in a minute");
    }
    client = await database.connect();
    await client.query(
      request.method === "GET"
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ"
        : "BEGIN",
    );
    let result;
    if (path.startsWith("/api/auth/"))
      result = await accountApi(client, request, path.slice(10));
    else {
      let user = await identity(client, request);
      if (request.method !== "GET") {
        await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
          user.workspace,
        ]);
        user = await identity(client, request);
      }
      result = path.startsWith("/api/workspace/")
        ? await workspaceApi(client, request, user, path.slice(15))
        : await api(client, request, path, user);
    }
    await client.query("COMMIT");
    send(...result);
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        client.release(true);
        client = null;
      }
    }
    if (health) return send(503, { postgres: "unavailable" });
    if (error.status) return send(error.status, { error: error.message });
    if (/^2[23][0-9A-Z]{3}$/.test(error.code ?? ""))
      return send(400, { error: "Invalid data for this operation" });
    send(500, { error: "The request could not be completed" });
  } finally {
    client?.release();
  }
}

const server = !process.env.VERCEL
  ? createServer(handleRequest)
  : null;

if (server) server.listen(
  Number(process.env.PORT ?? process.argv[2] ?? 3000),
  "127.0.0.1",
  () => {
    console.log(`Listening at http://127.0.0.1:${server.address().port}`);
  },
);
