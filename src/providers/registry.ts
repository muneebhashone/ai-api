import { ModelNotFoundError, BadRequestError } from "../lib/errors";
import { ClaudeCodeProvider } from "./claude-code";
import { CodexProvider } from "./codex";
import { DeepSeekProvider } from "./deepseek";
import { OpenCodeProvider } from "./opencode";
import { OpenRouterProvider } from "./openrouter";
import type { ModelInfo, Provider } from "./types";

const providers: Provider[] = [
  new OpenRouterProvider(),
  new DeepSeekProvider(),
  new ClaudeCodeProvider(),
  new CodexProvider(),
  new OpenCodeProvider(),
];

const byId = new Map<string, Provider>(providers.map((p) => [p.id, p]));

export function listProviders(): Provider[] {
  return providers;
}

export function getProvider(id: string): Provider {
  const p = byId.get(id);
  if (!p) throw new ModelNotFoundError(id);
  return p;
}

/**
 * Parse a namespaced model id like "openrouter/anthropic/claude-sonnet-4.5"
 * into { providerId: "openrouter", nativeId: "anthropic/claude-sonnet-4.5" }.
 */
export function parseModelId(id: string): { providerId: string; nativeId: string } {
  if (!id || typeof id !== "string") {
    throw new BadRequestError("model is required and must be a string");
  }
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) {
    throw new BadRequestError(
      `model '${id}' must be namespaced as 'provider/native-id' (e.g. 'openrouter/anthropic/claude-sonnet-4.5')`
    );
  }
  const providerId = id.slice(0, slash);
  const nativeId = id.slice(slash + 1);
  if (!byId.has(providerId)) {
    throw new ModelNotFoundError(id);
  }
  return { providerId, nativeId };
}

export async function listAllModels(): Promise<ModelInfo[]> {
  const results = await Promise.allSettled(providers.map((p) => p.listModels()));
  const all: ModelInfo[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      all.push(...r.value);
    } else {
      console.warn(`[registry] ${providers[i]!.id} listModels failed: ${r.reason?.message ?? r.reason}`);
    }
  });
  return all;
}
