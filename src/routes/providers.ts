import { Elysia } from "elysia";
import { getProvider, listProviders } from "../providers/registry";

export const providersRoutes = new Elysia()
  .get("/v1/providers", async () => {
    const providers = listProviders();
    const results = await Promise.all(
      providers.map(async (p) => {
        const [health, models] = await Promise.all([
          p.healthCheck(),
          p.listModels().catch(() => []),
        ]);
        return {
          id: p.id,
          capabilities: p.capabilities,
          healthy: health.ok,
          health_detail: health.detail,
          model_count: models.length,
        };
      })
    );
    return { object: "list", data: results };
  })
  .get("/v1/providers/:id", async ({ params }) => {
    const p = getProvider(params.id);
    const [health, models] = await Promise.all([p.healthCheck(), p.listModels().catch(() => [])]);
    return {
      id: p.id,
      capabilities: p.capabilities,
      healthy: health.ok,
      health_detail: health.detail,
      model_count: models.length,
    };
  })
  .get("/v1/providers/:id/models", async ({ params }) => {
    const p = getProvider(params.id);
    const models = await p.listModels();
    return {
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        owned_by: m.provider,
        provider: m.provider,
        capabilities: m.capabilities,
        context_window: m.contextWindow,
        description: m.description,
      })),
    };
  });
