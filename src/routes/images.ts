import { Elysia } from "elysia";
import { z } from "zod";
import { BadRequestError, ProviderError } from "../lib/errors";
import { getProvider, parseModelId } from "../providers/registry";

const BodySchema = z.object({
  model: z.string(),
  prompt: z.string().min(1),
  n: z.number().int().positive().max(10).optional(),
  size: z.string().optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
});

export const imageRoutes = new Elysia().post("/v1/images/generations", async ({ body }) => {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const { providerId, nativeId } = parseModelId(parsed.data.model);
  const provider = getProvider(providerId);
  if (!provider.generateImage) {
    throw new ProviderError(providerId, "does not support image generation");
  }

  const result = await provider.generateImage({
    model: nativeId,
    prompt: parsed.data.prompt,
    n: parsed.data.n,
    size: parsed.data.size,
    responseFormat: parsed.data.response_format,
  });
  return { created: result.created, data: result.data };
});
