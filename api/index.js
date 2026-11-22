import { handleRequest } from "../src/server.mjs";

export default function handler(request, response) {
  const url = new URL(request.url, "http://localhost");
  const path = url.searchParams.get("__overview_path");
  if (path && (path.startsWith("/api/") || path === "/health")) {
    request.url = path;
  }
  return handleRequest(request, response);
}
