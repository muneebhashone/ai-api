import { Elysia, t } from "elysia";
import { listAllModels } from "../providers/registry";
import { ModelNotFoundError } from "../lib/errors";
import { ErrorSchema, ModelListSchema, ModelSchema } from "../openapi-schemas";

export const modelsRoutes = new Elysia()
  .get(
    "/v1/models",
    async () => {
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
    },
    {
      response: {
        200: ModelListSchema,
      },
      detail: {
        summary: "List models",
        description: "Returns every model currently available through all configured providers.",
        tags: ["models"],
      },
    }
  )
  .get(
    "/v1/models/:id",
    async ({ params }) => {
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
    },
    {
      params: t.Object({
        id: t.String({ description: "Gateway model id that does not contain slashes." }),
      }),
      response: {
        200: ModelSchema,
        404: ErrorSchema,
      },
      detail: {
        summary: "Get model",
        description: "Returns metadata for one model. For model ids containing slashes, call the same URL-encoded path even though the wildcard fallback is hidden from docs.",
        tags: ["models"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "Gateway model id that does not contain slashes.",
          },
        ],
      },
    }
  )
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
