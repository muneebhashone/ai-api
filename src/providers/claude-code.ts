import { config } from "../config";
import { ProviderError } from "../lib/errors";
import { flattenMessages } from "../lib/messages";
import { TTLCache, memoize } from "../lib/model-cache";
import { runWithStdin } from "../lib/cli-spawn";
import type { ChatChunk, ChatRequest, HealthStatus, ModelInfo, Provider } from "./types";
import { DEFAULT_CAPS } from "./types";

const FALLBACK_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
];

const modelsCache = new TTLCache<ModelInfo[]>(5 * 60 * 1000);

export class ClaudeCodeProvider implements Provider {
  id = "claude-code";
  capabilities = {
    ...DEFAULT_CAPS,
    text: true,
    imageInput: true,
    tools: true,
    streaming: false,
    jsonMode: true,
    reasoningEffort: true,
  };

  async healthCheck(): Promise<HealthStatus> {
    try {
      await runWithStdin(config.bin.claudeCode, ["--version"], { swallowStdout: false });
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return memoize(modelsCache, "all", async () => {
      const ids = FALLBACK_MODELS;
      return ids.map((m) => this.toModelInfo(m));
    });
  }

  private toModelInfo(nativeId: string): ModelInfo {
    return {
      id: `${this.id}/${nativeId}`,
      nativeId,
      provider: this.id,
      capabilities: this.capabilities,
    };
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    let prompt = flattenMessages(req.messages);
    if (req.jsonMode) {
      prompt += "\n\nRespond with ONLY a single valid JSON object. No prose, no code fences, no explanation.";
    }

    const args = [
      "--print",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--model",
      req.model,
      ...(req.reasoningEffort ? ["--effort", req.reasoningEffort] : []),
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(req.reasoningEffort ? { CLAUDE_CODE_EFFORT_LEVEL: req.reasoningEffort } : {}),
    };

    if (config.log) {
      console.log(`[claude-code] -> model=${req.model} effort=${req.reasoningEffort ?? "default"} chars=${prompt.length}`);
    }
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    try {
      const result = await runWithStdin(config.bin.claudeCode, args, { stdin: prompt, env });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err) {
      throw new ProviderError(this.id, err instanceof Error ? err.message : String(err));
    }

    let parsed: { type?: string; is_error?: boolean; result?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new ProviderError(this.id, `non-JSON output: ${(err as Error).message}. Output: ${stdout.slice(0, 300)}`);
    }
    if (parsed.is_error || parsed.type !== "result") {
      throw new ProviderError(this.id, parsed.result || `error result. stderr: ${stderr.trim().slice(0, 300) || "(empty)"}`);
    }
    const text = (parsed.result ?? "").trim();
    if (!text) throw new ProviderError(this.id, "empty result");

    if (config.log) {
      console.log(`[claude-code] <- model=${req.model} ${Date.now() - startedAt}ms outChars=${text.length}`);
    }

    yield {
      delta: text,
      finishReason: "stop",
      usage: parsed.usage
        ? {
            prompt_tokens: parsed.usage.input_tokens,
            completion_tokens: parsed.usage.output_tokens,
            total_tokens: (parsed.usage.input_tokens ?? 0) + (parsed.usage.output_tokens ?? 0),
          }
        : undefined,
    };
  }
}
