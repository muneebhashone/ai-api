import { config } from "../config";
import { ProviderError, ProviderUnavailableError } from "../lib/errors";
import { TTLCache, memoize } from "../lib/model-cache";
import type { ChatChunk, ChatRequest, HealthStatus, ModelInfo, Provider } from "./types";
import { DEFAULT_CAPS } from "./types";

const FALLBACK_MODELS = [
  { id: "deepseek-v4-flash", contextWindow: 128_000, description: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", contextWindow: 128_000, description: "DeepSeek V4 Pro" },
];
const modelsCache = new TTLCache<ModelInfo[]>(5 * 60 * 1000);

interface DeepSeekModel {
  id: string;
}

type DeepSeekReasoningEffort = "high" | "max";

function deepSeekReasoningEffort(effort?: ChatRequest["reasoningEffort"]): DeepSeekReasoningEffort | undefined {
  if (!effort) return undefined;
  if (effort === "max" || effort === "xhigh") return "max";
  return "high";
}

function hasAssistantPrefix(messages: ChatRequest["messages"]): boolean {
  return messages.some((m) => m.role === "assistant" && (m as unknown as Record<string, unknown>).prefix === true);
}

function hasStrictTool(extraParams?: Record<string, unknown>): boolean {
  const tools = extraParams?.tools;
  return Array.isArray(tools) && tools.some((tool) => {
    const fn = typeof tool === "object" && tool !== null ? (tool as Record<string, unknown>).function : undefined;
    return typeof fn === "object" && fn !== null && (fn as Record<string, unknown>).strict === true;
  });
}

export function shouldUseDeepSeekBeta(req: ChatRequest): boolean {
  return hasAssistantPrefix(req.messages) || hasStrictTool(req.extraParams);
}

export function buildDeepSeekChatBody(req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...(req.extraParams ?? {}),
    model: req.model,
    messages: req.messages,
    stream: req.stream,
  };

  if (config.deepseek.defaultThinking !== "none" && body.thinking === undefined) {
    body.thinking = { type: config.deepseek.defaultThinking };
  }

  const thinkingType = typeof body.thinking === "object" && body.thinking !== null
    ? (body.thinking as Record<string, unknown>).type
    : undefined;
  const shouldDefaultReasoning = thinkingType === undefined || thinkingType === "enabled";
  if (body.reasoning_effort === undefined && shouldDefaultReasoning) {
    body.reasoning_effort =
      deepSeekReasoningEffort(req.reasoningEffort) ?? config.deepseek.defaultReasoningEffort;
  }

  if (req.stream && body.stream_options === undefined) {
    body.stream_options = { include_usage: true };
  }

  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.stop !== undefined) body.stop = req.stop;
  if (req.jsonMode) body.response_format = { type: "json_object" };
  return body;
}

export function parseDeepSeekStreamPayload(payload: string): ChatChunk | undefined {
  if (!payload || payload === "[DONE]") return undefined;
  const parsed = JSON.parse(payload) as {
    choices?: { delta?: Record<string, unknown> & { content?: string | null }; finish_reason?: string | null }[];
    usage?: ChatChunk["usage"];
  };
  const choice = parsed.choices?.[0];
  const deltaObject = choice?.delta;
  const delta = typeof deltaObject?.content === "string" ? deltaObject.content : "";
  const deltaExtra = deltaObject ? Object.fromEntries(Object.entries(deltaObject).filter(([key]) => key !== "content")) : undefined;
  const finish = choice?.finish_reason ?? undefined;
  if (delta || finish || parsed.usage || (deltaExtra && Object.keys(deltaExtra).length > 0)) {
    return {
      delta,
      deltaExtra,
      usage: parsed.usage,
      finishReason: finish,
    };
  }
  return undefined;
}

export class DeepSeekProvider implements Provider {
  id = "deepseek";
  capabilities = {
    ...DEFAULT_CAPS,
    text: true,
    streaming: true,
    jsonMode: true,
    tools: true,
    reasoningEffort: true,
  };

  private headers(): Record<string, string> {
    if (!config.deepseek.apiKey) {
      throw new ProviderUnavailableError(this.id, "DEEPSEEK_API_KEY not set");
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseek.apiKey}`,
    };
  }

  private url(path: string, beta = false): string {
    const base = beta ? `${config.deepseek.baseUrl}/beta` : config.deepseek.baseUrl;
    return `${base}${path}`;
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!config.deepseek.apiKey) return { ok: false, detail: "DEEPSEEK_API_KEY not set" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeouts.deepseekMs);
    try {
      const res = await fetch(this.url("/models"), { headers: this.headers(), signal: controller.signal });
      return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!config.deepseek.apiKey) return [];
    return memoize(modelsCache, "all", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeouts.deepseekMs);
      try {
        const res = await fetch(this.url("/models"), { headers: this.headers(), signal: controller.signal });
        if (!res.ok) throw new ProviderError(this.id, `models endpoint HTTP ${res.status}`);
        const data = (await res.json()) as { data?: DeepSeekModel[] };
        const models = (data.data ?? []).map((m) => this.toModelInfo(m.id));
        return models.length ? models : FALLBACK_MODELS.map((m) => this.toModelInfo(m.id, m.description, m.contextWindow));
      } catch (err) {
        console.warn(`[deepseek] models endpoint failed, using fallback models: ${(err as Error).message}`);
        return FALLBACK_MODELS.map((m) => this.toModelInfo(m.id, m.description, m.contextWindow));
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private toModelInfo(nativeId: string, description?: string, contextWindow?: number): ModelInfo {
    return {
      id: `${this.id}/${nativeId}`,
      nativeId,
      provider: this.id,
      capabilities: this.capabilities,
      contextWindow,
      description,
    };
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const body = buildDeepSeekChatBody(req);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeouts.deepseekMs);
    const beta = shouldUseDeepSeekBeta(req);
    const startedAt = Date.now();

    if (config.log) {
      console.log(`[deepseek] -> model=${req.model} stream=${req.stream} beta=${beta} effort=${body.reasoning_effort ?? "default"}`);
    }

    const res = await fetch(this.url("/chat/completions", beta), {
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
        usage?: ChatChunk["usage"];
      };
      const message = data.choices?.[0]?.message;
      const content = typeof message?.content === "string" ? message.content : "";
      if (config.log) {
        console.log(`[deepseek] <- model=${req.model} ${Date.now() - startedAt}ms outChars=${content.length}`);
      }
      yield {
        delta: content,
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
          if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try {
            const chunk = parseDeepSeekStreamPayload(payload);
            if (chunk) yield chunk;
          } catch {
            // Ignore malformed stream lines.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
