import { Elysia } from "elysia";
import { config } from "./config";
import { toOpenAIError } from "./lib/errors";
import { chatRoutes } from "./routes/chat";
import { imageRoutes } from "./routes/images";
import { modelsRoutes } from "./routes/models";
import { providersRoutes } from "./routes/providers";
import { stat, readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { isWithinDirectory } from "./lib/path-safety";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

const app = new Elysia()
  .onError(({ error, set }) => {
    const { status, body } = toOpenAIError(error);
    set.status = status;
    return body;
  })
  .get("/", () => ({
    name: "ai-api gateway",
    version: "0.1.0",
    routes: ["/v1/models", "/v1/models/:id", "/v1/providers", "/v1/providers/:id", "/v1/providers/:id/models", "/v1/chat/completions", "/v1/images/generations"],
  }))
  .get("/healthz", () => ({ ok: true }))
  // Static serve for generated/ — image gen URL responses
  .get("/generated/*", async ({ params, set }) => {
    const rel = (params as { "*": string })["*"];
    const root = resolve(process.cwd(), "generated");
    const safe = resolve(root, rel);
    if (!isWithinDirectory(root, safe)) {
      set.status = 403;
      return "forbidden";
    }
    const info = await stat(safe).catch(() => null);
    if (!info?.isFile()) {
      set.status = 404;
      return "not found";
    }
    const ext = extname(safe).toLowerCase();
    set.headers["Content-Type"] = MIME[ext] ?? "application/octet-stream";
    return new Response(await readFile(safe));
  })
  .use(modelsRoutes)
  .use(providersRoutes)
  .use(chatRoutes)
  .use(imageRoutes)
  .all("*", ({ set }) => {
    set.status = 404;
    return { error: { message: "Not found", type: "not_found", code: "not_found" } };
  })
  .listen({ port: config.port, hostname: "127.0.0.1" });

console.log(`ai-api gateway listening on http://127.0.0.1:${config.port}`);
