import { t } from "elysia";

export const CapabilitiesSchema = t.Object(
  {
    text: t.Boolean({ description: "Supports text generation." }),
    imageInput: t.Boolean({ description: "Accepts image inputs in chat messages." }),
    imageGeneration: t.Boolean({ description: "Supports image generation." }),
    videoGeneration: t.Boolean({ description: "Supports video generation." }),
    tools: t.Boolean({ description: "Supports tool or function calling." }),
    streaming: t.Boolean({ description: "Supports streamed responses." }),
    jsonMode: t.Boolean({ description: "Supports JSON-mode output requests." }),
    reasoningEffort: t.Boolean({ description: "Supports reasoning effort controls." }),
  },
  { description: "Capability flags exposed by a provider or model." }
);

export const ModelSchema = t.Object(
  {
    id: t.String({ description: "Gateway model id. Provider-prefixed ids use provider/native-model format." }),
    object: t.String({ description: "OpenAI-compatible object type.", examples: ["model"] }),
    created: t.Optional(t.Number({ description: "Unix timestamp. Dynamic provider models use 0 when unavailable." })),
    owned_by: t.String({ description: "Provider that owns or serves the model." }),
    provider: t.String({ description: "Gateway provider id." }),
    capabilities: CapabilitiesSchema,
    context_window: t.Optional(t.Number({ description: "Maximum context window in tokens, when known." })),
    description: t.Optional(t.String({ description: "Provider-supplied model description, when available." })),
  },
  { description: "OpenAI-compatible model record with gateway metadata." }
);

export const ModelListSchema = t.Object(
  {
    object: t.String({ description: "OpenAI-compatible list object.", examples: ["list"] }),
    data: t.Array(ModelSchema, { description: "Available models." }),
  },
  { description: "List of available gateway models." }
);

export const ProviderSchema = t.Object(
  {
    id: t.String({ description: "Gateway provider id." }),
    capabilities: CapabilitiesSchema,
    healthy: t.Boolean({ description: "Whether the provider health check is currently passing." }),
    health_detail: t.Optional(t.String({ description: "Provider-specific health detail or error message." })),
    model_count: t.Number({ description: "Number of models currently reported by this provider." }),
  },
  { description: "Provider status and capability summary." }
);

export const ProviderListSchema = t.Object(
  {
    object: t.String({ description: "OpenAI-compatible list object.", examples: ["list"] }),
    data: t.Array(ProviderSchema, { description: "Registered providers." }),
  },
  { description: "List of configured providers." }
);

export const ProviderModelsSchema = t.Object(
  {
    object: t.String({ description: "OpenAI-compatible list object.", examples: ["list"] }),
    data: t.Array(
      t.Omit(ModelSchema, ["created"]),
      { description: "Models served by the provider." }
    ),
  },
  { description: "Models available from one provider." }
);

export const ErrorSchema = t.Object(
  {
    error: t.Object({
      message: t.String({ description: "Human-readable error message." }),
      type: t.String({ description: "Stable error type." }),
      code: t.Optional(t.String({ description: "Stable machine-readable error code." })),
    }),
  },
  { description: "OpenAI-compatible error response." }
);

const ChatMessageSchema = t.Object(
  {
    role: t.String({ description: "Message role, such as system, user, assistant, or tool." }),
    content: t.Optional(t.Nullable(t.Any({ description: "Message content. Strings and multimodal arrays are accepted." }))),
  },
  {
    additionalProperties: true,
    description: "OpenAI-compatible chat message. Extra provider-specific fields are passed through.",
  }
);

export const ChatCompletionRequestSchema = t.Object(
  {
    model: t.String({ description: "Gateway model id, for example openrouter/anthropic/claude-sonnet-4.5." }),
    messages: t.Array(ChatMessageSchema, {
      minItems: 1,
      description: "Conversation messages to send to the selected model.",
    }),
    stream: t.Optional(t.Boolean({ description: "When true, returns server-sent events using OpenAI chat chunk format." })),
    temperature: t.Optional(t.Number({ description: "Sampling temperature passed through to the provider." })),
    top_p: t.Optional(t.Number({ description: "Nucleus sampling value passed through to the provider." })),
    max_tokens: t.Optional(t.Integer({ minimum: 1, description: "Maximum completion tokens to request." })),
    stop: t.Optional(t.Union([t.String(), t.Array(t.String())], { description: "Stop sequence or sequences." })),
    response_format: t.Optional(
      t.Record(t.String(), t.Any(), {
        description: "OpenAI-compatible response format object. Use { type: 'json_object' } for JSON mode.",
      })
    ),
    reasoning_effort: t.Optional(
      t.Union(
        [t.Literal("low"), t.Literal("medium"), t.Literal("high"), t.Literal("xhigh"), t.Literal("max")],
        { description: "Reasoning effort hint for models/providers that support it." }
      )
    ),
    reasoning: t.Optional(
      t.Object({
        effort: t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high"), t.Literal("xhigh"), t.Literal("max")]),
      }, { description: "Alternative reasoning configuration object." })
    ),
  },
  {
    additionalProperties: true,
    description: "OpenAI-compatible chat completion request. Unknown fields are forwarded to the provider.",
  }
);

const UsageSchema = t.Object({
  prompt_tokens: t.Optional(t.Number({ description: "Prompt token count, when reported." })),
  completion_tokens: t.Optional(t.Number({ description: "Completion token count, when reported." })),
  total_tokens: t.Optional(t.Number({ description: "Total token count, when reported." })),
});

export const ChatCompletionSchema = t.Object(
  {
    id: t.String({ description: "Generated chat completion id." }),
    object: t.String({ description: "OpenAI-compatible object type.", examples: ["chat.completion"] }),
    created: t.Number({ description: "Unix timestamp when the response was created." }),
    model: t.String({ description: "Requested gateway model id." }),
    choices: t.Array(
      t.Object({
        index: t.Number({ description: "Choice index." }),
        message: t.Object(
          {
            role: t.String({ description: "Assistant role." }),
            content: t.Nullable(t.String({ description: "Assistant message content." })),
          },
          { additionalProperties: true }
        ),
        finish_reason: t.String({ description: "Provider finish reason." }),
      })
    ),
    usage: t.Optional(UsageSchema),
  },
  { description: "OpenAI-compatible non-streaming chat completion response." }
);

export const ImageGenerationRequestSchema = t.Object(
  {
    model: t.String({ description: "Gateway image model id." }),
    prompt: t.String({ minLength: 1, description: "Image generation prompt." }),
    n: t.Optional(t.Integer({ minimum: 1, maximum: 10, description: "Number of images to generate." })),
    size: t.Optional(t.String({ description: "Requested output size, for example 1024x1024." })),
    response_format: t.Optional(
      t.Union([t.Literal("url"), t.Literal("b64_json")], {
        description: "Return generated images as local URLs or base64 JSON.",
      })
    ),
  },
  { description: "OpenAI-compatible image generation request." }
);

export const ImageGenerationResponseSchema = t.Object(
  {
    created: t.Number({ description: "Unix timestamp when images were created." }),
    data: t.Array(
      t.Object({
        url: t.Optional(t.String({ description: "URL for a generated image when response_format is url." })),
        b64_json: t.Optional(t.String({ description: "Base64 image data when response_format is b64_json." })),
      }),
      { description: "Generated image results." }
    ),
  },
  { description: "OpenAI-compatible image generation response." }
);

export const RootResponseSchema = t.Object({
  name: t.String({ description: "Service name." }),
  version: t.String({ description: "Gateway API version." }),
  docs: t.String({ description: "OpenAPI documentation URL." }),
  routes: t.Array(t.String(), { description: "Primary documented routes." }),
});

export const HealthResponseSchema = t.Object({
  ok: t.Boolean({ description: "True when the gateway process is responding." }),
});
