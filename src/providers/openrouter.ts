import { config } from "../config";
import { ProviderError, ProviderUnavailableError } from "../lib/errors";
import { TTLCache, memoize } from "../lib/model-cache";
import type { ChatChunk, ChatRequest, HealthStatus, ModelInfo, Provider } from "./types";
import { DEFAULT_CAPS } from "./types";

const BASE_URL = "https://openrouter.ai/api/v1";
const modelsCache = new TTLCache<ModelInfo[]>(5 * 60 * 1000);

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  description?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
}

export class OpenRouterProvider implements Provider {
  id = "openrouter";
  capabilities = {
    ...DEFAULT_CAPS,
    text: true,
    imageInput: true,
    streaming: true,
    jsonMode: true,
    tools: true,
  };

  private headers(): Record<string, string> {
    if (!config.openrouter.apiKey) {
      throw new ProviderUnavailableError(this.id, "OPENROUTER_API_KEY not set");
    }
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openrouter.apiKey}`,
    };
    if (config.openrouter.siteUrl) h["HTTP-Referer"] = config.openrouter.siteUrl;
    if (config.openrouter.appName) h["X-Title"] = config.openrouter.appName;
    return h;
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!config.openrouter.apiKey) return { ok: false, detail: "OPENROUTER_API_KEY not set" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeouts.openrouterMs);
    try {
      const res = await fetch(`${BASE_URL}/models`, { headers: this.headers(), signal: controller.signal });
      return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!config.openrouter.apiKey) return [];
    return memoize(modelsCache, "all", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeouts.openrouterMs);
      const res = await fetch(`${BASE_URL}/models`, { headers: this.headers(), signal: controller.signal }).finally(() => clearTimeout(timeout));
      if (!res.ok) throw new ProviderError(this.id, `models endpoint HTTP ${res.status}`);
      const data = (await res.json()) as { data?: OpenRouterModel[] };
      return (data.data ?? []).map((m) => this.toModelInfo(m));
    });
  }

  private toModelInfo(m: OpenRouterModel): ModelInfo {
    const inputs = m.architecture?.input_modalities ?? [];
    const outputs = m.architecture?.output_modalities ?? [];
    const params = m.supported_parameters ?? [];
    return {
      id: `${this.id}/${m.id}`,
      nativeId: m.id,
      provider: this.id,
      capabilities: {
        ...DEFAULT_CAPS,
        text: outputs.includes("text") || outputs.length === 0,
        imageInput: inputs.includes("image"),
        imageGeneration: outputs.includes("image"),
        streaming: true,
        jsonMode: params.includes("response_format") || params.includes("structured_outputs"),
        tools: params.includes("tools"),
        reasoningEffort: params.includes("reasoning"),
      },
      contextWindow: m.context_length,
      description: m.description,
    };
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const body: Record<string, unknown> = {
      ...(req.extraParams ?? {}),
      model: req.model,
      messages: req.messages,
      stream: req.stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.stop !== undefined) body.stop = req.stop;
    if (req.jsonMode) body.response_format = { type: "json_object" };
    if (req.reasoningEffort && req.reasoningEffort !== "max") {
      body.reasoning = { effort: req.reasoningEffort };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeouts.openrouterMs);
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) {
      const text = await res.text();
      throw new ProviderError(this.id, `HTTP ${res.status}: ${text.slice(0, 400)}`);
    }

    if (!req.stream) {
      const data = (await res.json()) as {
        choices?: { message?: Record<string, unknown> & { content?: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const message = data.choices?.[0]?.message;
      yield {
        delta: typeof message?.content === "string" ? message.content : "",
        message,
        usage: data.usage,
        finishReason: data.choices?.[0]?.finish_reason ?? "stop",
      };
      return;
    }

    if (!res.body) throw new ProviderError(this.id, "stream response has no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).replace(/\r$/, "").trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            const parsed = JSON.parse(payload) as {
              choices?: { delta?: Record<string, unknown> & { content?: string }; finish_reason?: string }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            const deltaObject = parsed.choices?.[0]?.delta;
            const delta = deltaObject?.content ?? "";
            const finish = parsed.choices?.[0]?.finish_reason;
            const deltaExtra = deltaObject ? Object.fromEntries(Object.entries(deltaObject).filter(([key]) => key !== "content")) : undefined;
            if (delta || finish || parsed.usage || (deltaExtra && Object.keys(deltaExtra).length > 0)) {
              yield {
                delta,
                deltaExtra,
                usage: parsed.usage,
                finishReason: finish ?? undefined,
              };
            }
          } catch {
            // ignore malformed line (OpenRouter occasionally sends comments)
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
