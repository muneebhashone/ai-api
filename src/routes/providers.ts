import { Elysia, t } from "elysia";
import { getProvider, listProviders } from "../providers/registry";
import { ErrorSchema, ProviderListSchema, ProviderModelsSchema, ProviderSchema } from "../openapi-schemas";

export const providersRoutes = new Elysia()
  .get(
    "/v1/providers",
    async () => {
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
    },
    {
      response: {
        200: ProviderListSchema,
      },
      detail: {
        summary: "List providers",
        description: "Returns configured provider ids, health status, capability flags, and current model counts.",
        tags: ["providers"],
      },
    }
  )
  .get(
    "/v1/providers/:id",
    async ({ params }) => {
      const p = getProvider(params.id);
      const [health, models] = await Promise.all([p.healthCheck(), p.listModels().catch(() => [])]);
      return {
        id: p.id,
        capabilities: p.capabilities,
        healthy: health.ok,
        health_detail: health.detail,
        model_count: models.length,
      };
    },
    {
      params: t.Object({
        id: t.String({ description: "Provider id, for example openrouter, deepseek, codex, claude-code, or opencode." }),
      }),
      response: {
        200: ProviderSchema,
        404: ErrorSchema,
      },
      detail: {
        summary: "Get provider",
        description: "Returns health and capability details for a single configured provider.",
        tags: ["providers"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Provider id, for example openrouter, deepseek, codex, claude-code, or opencode.",
          },
        ],
      },
    }
  )
  .get(
    "/v1/providers/:id/models",
    async ({ params }) => {
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
    },
    {
      params: t.Object({
        id: t.String({ description: "Provider id whose models should be listed." }),
      }),
      response: {
        200: ProviderModelsSchema,
        404: ErrorSchema,
      },
      detail: {
        summary: "List provider models",
        description: "Returns models currently available from one provider.",
        tags: ["providers", "models"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Provider id whose models should be listed.",
          },
        ],
      },
    }
  );
