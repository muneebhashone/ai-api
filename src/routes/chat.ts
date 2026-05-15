import { Elysia } from "elysia";
import { z } from "zod";
import { BadRequestError } from "../lib/errors";
import { buildChatCompletion, buildChunk, newCompletionId } from "../lib/openai-shape";
import { SSE_DONE, SSE_HEADERS, sseFrame } from "../lib/sse";
import { getProvider, parseModelId } from "../providers/registry";
import type { ChatChunk, ChatRequest } from "../providers/types";

const MessageSchema = z.object({
  role: z.string().min(1),
  content: z.any().optional().nullable(),
}).passthrough();

const BodySchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  response_format: z.record(z.string(), z.unknown()).optional(),
  reasoning_effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  reasoning: z.object({ effort: z.enum(["low", "medium", "high", "xhigh", "max"]) }).optional(),
}).passthrough();

const HANDLED_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "temperature",
  "top_p",
  "max_tokens",
  "stop",
  "response_format",
  "reasoning_effort",
  "reasoning",
]);

function collectExtraParams(body: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!HANDLED_KEYS.has(key) && value !== undefined) extra[key] = value;
  }
  return extra;
}

export const chatRoutes = new Elysia().post("/v1/chat/completions", async ({ body, set }) => {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const { providerId, nativeId } = parseModelId(parsed.data.model);
  const provider = getProvider(providerId);

  const stream = parsed.data.stream === true;
  const req: ChatRequest = {
    model: nativeId,
    messages: parsed.data.messages as ChatRequest["messages"],
    stream,
    temperature: parsed.data.temperature,
    topP: parsed.data.top_p,
    maxTokens: parsed.data.max_tokens,
    stop: parsed.data.stop,
    jsonMode: parsed.data.response_format?.type === "json_object",
    reasoningEffort: parsed.data.reasoning_effort ?? parsed.data.reasoning?.effort,
    extraParams: collectExtraParams(parsed.data),
  };

  const id = newCompletionId();

  if (!stream) {
    let content = "";
    let usage;
    let finishReason = "stop";
    let message: Record<string, unknown> | undefined;
    for await (const chunk of provider.chat(req)) {
      content += chunk.delta;
      if (chunk.message) message = chunk.message;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }
    return buildChatCompletion({
      id,
      model: parsed.data.model,
      content,
      usage,
      finishReason,
      message,
    });
  }

  // Streaming response
  for (const [k, v] of Object.entries(SSE_HEADERS)) set.headers[k] = v;
  set.headers["Transfer-Encoding"] = "chunked";

  const encoder = new TextEncoder();
  const iterable = provider.chat(req);
  let iterator: (AsyncIterator<ChatChunk> & { return?: () => Promise<IteratorResult<ChatChunk>> }) | undefined;
  const modelLabel = parsed.data.model;

  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Initial chunk with role
        controller.enqueue(
          encoder.encode(
            sseFrame(buildChunk({ id, model: modelLabel, delta: "", role: "assistant" }))
          )
        );
        let finalUsage;
        let finalFinish = "stop";
        iterator = iterable[Symbol.asyncIterator]();
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          const chunk = next.value;
          if (chunk.delta || chunk.deltaExtra) {
            controller.enqueue(
              encoder.encode(sseFrame(buildChunk({ id, model: modelLabel, delta: chunk.delta, deltaExtra: chunk.deltaExtra })))
            );
          }
          if (chunk.usage) finalUsage = chunk.usage;
          if (chunk.finishReason) finalFinish = chunk.finishReason;
        }
        controller.enqueue(
          encoder.encode(
            sseFrame(
              buildChunk({
                id,
                model: modelLabel,
                delta: "",
                finishReason: finalFinish,
                usage: finalUsage,
              })
            )
          )
        );
        controller.enqueue(encoder.encode(SSE_DONE));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(sseFrame({ error: { message, type: "provider_error" } }))
        );
        controller.enqueue(encoder.encode(SSE_DONE));
        controller.close();
      }
    },
    async cancel() {
      await iterator?.return?.();
    },
  });

  return new Response(body$, { headers: SSE_HEADERS });
});
