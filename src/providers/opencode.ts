import { config } from "../config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError } from "../lib/errors";
import { flattenMessages } from "../lib/messages";
import { TTLCache, memoize } from "../lib/model-cache";
import { runWithStdin, spawnStream } from "../lib/cli-spawn";
import type { ChatChunk, ChatRequest, HealthStatus, ModelInfo, Provider } from "./types";
import { DEFAULT_CAPS } from "./types";

const modelsCache = new TTLCache<ModelInfo[]>(5 * 60 * 1000);
const MAX_DIRECT_PROMPT_CHARS = 7000;

interface OpenCodeEvent {
  type?: string;
  part?: { type?: string; text?: string };
  error?: { name?: string; data?: { message?: string }; message?: string };
}

export class OpenCodeProvider implements Provider {
  id = "opencode";
  capabilities = {
    ...DEFAULT_CAPS,
    text: true,
    imageInput: true,
    tools: true,
    streaming: true,
    jsonMode: true,
  };

  async healthCheck(): Promise<HealthStatus> {
    try {
      await runWithStdin(config.bin.opencode, ["--version"]);
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return memoize(modelsCache, "all", async () => {
      try {
        const { stdout } = await runWithStdin(config.bin.opencode, ["models"]);
        const ids = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
        return ids.map((id) => this.toModelInfo(id));
      } catch {
        return [];
      }
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
    const tempDir = prompt.length > MAX_DIRECT_PROMPT_CHARS ? await mkdtemp(join(tmpdir(), "ai-api-opencode-")) : undefined;
    const promptFile = tempDir ? join(tempDir, "prompt.txt") : undefined;
    if (promptFile) await writeFile(promptFile, prompt, "utf8");
    const directPrompt = prompt.replace(/\r?\n/g, "\\n");
    const args = [
      "run",
      promptFile ? "Read the attached prompt file and answer it directly in chat. Do not create or edit files." : directPrompt,
      "--model",
      req.model,
      "--format",
      "json",
      "--dangerously-skip-permissions",
      ...(promptFile ? ["--file", promptFile] : []),
    ];

    if (config.log) {
      console.log(`[opencode] -> model=${req.model} chars=${prompt.length}`);
    }
    const startedAt = Date.now();

    let acc = "";
    let yieldedAny = false;
    let lastEmitted = "";

    try {
      for await (const line of spawnStream(config.bin.opencode, args, { lineMode: true })) {
      let ev: OpenCodeEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "error" || ev.error) {
        const detail = ev.error?.data?.message ?? ev.error?.message ?? ev.error?.name ?? "unknown OpenCode error";
        throw new ProviderError(this.id, detail);
      }
      const part = ev.part;
      if (!part || part.type !== "text" || typeof part.text !== "string") continue;
      // OpenCode emits cumulative `text` per event. Compute the delta vs last emitted.
      const next = part.text;
      let delta: string;
      if (next.startsWith(lastEmitted)) {
        delta = next.slice(lastEmitted.length);
      } else {
        // Restart / unrelated stream — emit as-is, append.
        delta = next;
      }
      lastEmitted = next;
      if (delta) {
        acc += delta;
        yieldedAny = true;
        yield { delta };
      }
      }
    } catch (err) {
      throw new ProviderError(this.id, err instanceof Error ? err.message : String(err));
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    if (config.log) {
      console.log(`[opencode] <- model=${req.model} ${Date.now() - startedAt}ms outChars=${acc.length}`);
    }
    if (!yieldedAny) {
      throw new ProviderError(this.id, "no text content emitted");
    }
    yield { delta: "", finishReason: "stop" };
  }
}
