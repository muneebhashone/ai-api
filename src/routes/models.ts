import { Elysia } from "elysia";
import { listAllModels } from "../providers/registry";
import { ModelNotFoundError } from "../lib/errors";

export const modelsRoutes = new Elysia()
  .get("/v1/models", async () => {
    const models = await listAllModels();
    return {
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: m.provider,
        provider: m.provider,
        capabilities: m.capabilities,
        context_window: m.contextWindow,
        description: m.description,
      })),
    };
  })
  .get("/v1/models/:id", async ({ params }) => {
    const all = await listAllModels();
    // Elysia decodes :id but slashes are not allowed in a single param.
    // Accept everything after /v1/models/ via wildcard fallback below.
    const m = all.find((x) => x.id === params.id);
    if (!m) throw new ModelNotFoundError(params.id);
    return {
      id: m.id,
      object: "model",
      created: 0,
      owned_by: m.provider,
      provider: m.provider,
      capabilities: m.capabilities,
      context_window: m.contextWindow,
      description: m.description,
    };
  })
  .get("/v1/models/*", async ({ params }) => {
    const id = (params as { "*": string })["*"];
    const all = await listAllModels();
    const m = all.find((x) => x.id === id);
    if (!m) throw new ModelNotFoundError(id);
    return {
      id: m.id,
      object: "model",
      created: 0,
      owned_by: m.provider,
      provider: m.provider,
      capabilities: m.capabilities,
      context_window: m.contextWindow,
      description: m.description,
    };
  });
