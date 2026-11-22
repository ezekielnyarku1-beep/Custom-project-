import { handleRequest } from "../src/server.mjs";

export default function handler(request, response) {
  if (new URL(request.url, "http://localhost").pathname === "/api/health") {
    request.url = "/health";
  }
  return handleRequest(request, response);
}
