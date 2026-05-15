import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config";
import { ProviderError } from "../lib/errors";
import { flattenMessages } from "../lib/messages";
import { TTLCache, memoize } from "../lib/model-cache";
import { runWithStdin } from "../lib/cli-spawn";
import type { ChatChunk, ChatRequest, HealthStatus, ImageRequest, ImageResult, ModelInfo, Provider } from "./types";
import { DEFAULT_CAPS } from "./types";
import { mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { isWithinDirectory } from "../lib/path-safety";

const FALLBACK_MODELS = ["gpt-5-codex", "gpt-5", "gpt-5-mini", "o4-mini"];
const ALLOWED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const modelsCache = new TTLCache<ModelInfo[]>(5 * 60 * 1000);

interface CodexModelEntry {
  id?: string;
  slug?: string;
  name?: string;
  display_name?: string;
  description?: string;
}

export function parseCodexModelEntries(raw: string): { id: string; description?: string }[] {
  const parsed = JSON.parse(raw) as { models?: CodexModelEntry[] } | CodexModelEntry[];
  const arr = Array.isArray(parsed) ? parsed : parsed.models ?? [];
  return arr.flatMap((m) => {
    const id = m.id ?? m.slug;
    if (!id) return [];
    return [{ id, description: m.description ?? m.display_name ?? m.name }];
  });
}

export class CodexProvider implements Provider {
  id = "codex";
  capabilities = {
    ...DEFAULT_CAPS,
    text: true,
    imageInput: true,
    imageGeneration: true,
    streaming: false,
    jsonMode: true,
    reasoningEffort: true,
  };

  async healthCheck(): Promise<HealthStatus> {
    try {
      await runWithStdin(config.bin.codex, ["--version"]);
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return memoize(modelsCache, "all", async () => {
      try {
        const { stdout } = await runWithStdin(config.bin.codex, ["debug", "models"]);
        const models = parseCodexModelEntries(stdout);
        if (models.length) return models.map((m) => this.toModelInfo(m.id, m.description));
      } catch {
        // fall through to hardcoded list
      }
      return FALLBACK_MODELS.map((id) => this.toModelInfo(id));
    });
  }

  private toModelInfo(nativeId: string, description?: string): ModelInfo {
    return {
      id: `${this.id}/${nativeId}`,
      nativeId,
      provider: this.id,
      capabilities: this.capabilities,
      description,
    };
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    let prompt = flattenMessages(req.messages);
    if (req.jsonMode) {
      prompt += "\n\nRespond with ONLY a single valid JSON object. No prose, no code fences, no explanation.";
    }

    const tempDir = await mkdtemp(join(tmpdir(), "ai-api-codex-"));
    const outputFile = join(tempDir, "last-message.txt");
    const effort = req.reasoningEffort && req.reasoningEffort !== "max" ? req.reasoningEffort : undefined;
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "-c",
      'approval_policy="never"',
      "--model",
      req.model,
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      "--output-last-message",
      outputFile,
      "-",
    ];

    if (config.log) {
      console.log(`[codex] -> model=${req.model} effort=${effort ?? "default"} chars=${prompt.length}`);
    }
    const startedAt = Date.now();

    try {
      const { stderr } = await runWithStdin(config.bin.codex, args, { stdin: prompt });
      const text = (await readFile(outputFile, "utf8")).trim();
      if (!text) {
        throw new ProviderError(this.id, `empty result. stderr: ${stderr.trim().slice(0, 300) || "(empty)"}`);
      }
      if (config.log) {
        console.log(`[codex] <- model=${req.model} ${Date.now() - startedAt}ms outChars=${text.length}`);
      }
      yield { delta: text, finishReason: "stop" };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const safePrefix = sanitizePrefix(req.model.replace(/[/:]/g, "-"));
    const outDir = await mkdtemp(join(tmpdir(), "ai-api-codex-image-"));
    const outputFile = join(outDir, "last-message.txt");
    const prompt = [
      "Use the image generation feature to create exactly one image from this prompt.",
      "Save the image file in the current working directory.",
      `Use a filename beginning with ${safePrefix}.`,
      "Return only the generated image filename or absolute path. No prose.",
      "",
      "Image prompt:",
      req.prompt.trim(),
    ].join("\n");

    const model = req.model || config.codexImage.model;
    const reasoning = config.codexImage.reasoningEffort;
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-c",
      'approval_policy="never"',
      "--model",
      model,
      ...(reasoning ? ["-c", `model_reasoning_effort="${reasoning}"`] : []),
      "--output-last-message",
      outputFile,
      "-",
    ];

    try {
      await new Promise<void>((resolvePromise, reject) => {
        let stderr = "";
        runWithStdin(config.bin.codex, args, { stdin: prompt, cwd: outDir, swallowStdout: true })
          .then(() => resolvePromise())
          .catch((err) => {
            stderr = err instanceof Error ? err.message : String(err);
            reject(new ProviderError(this.id, `image gen failed. ${stderr.trim().slice(0, 300)}`));
          });
      });

      const returned = (await readFile(outputFile, "utf8").catch(() => "")).trim();
      const generated = await findGeneratedImage(outDir, returned);
      const ext = extname(generated).toLowerCase();

      if (req.responseFormat === "url") {
        // Persist into ./generated/ and serve via static route.
        const publicDir = resolve(process.cwd(), "generated");
        await mkdir(publicDir, { recursive: true });
        const publicName = `${safePrefix}-${Date.now()}${ext}`;
        await copyFile(generated, join(publicDir, publicName));
        return { created: Math.floor(Date.now() / 1000), data: [{ url: `/generated/${publicName}` }] };
      }

      // Default: b64_json (OpenAI default)
      const buf = await readFile(generated);
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: buf.toString("base64") }],
      };
    } finally {
      await rm(outDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function sanitizePrefix(prefix: string): string {
  const cleaned = prefix.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "image";
}

async function findGeneratedImage(outDir: string, returned: string): Promise<string> {
  const safeRoot = resolve(outDir);
  const candidates: string[] = [];
  const cleaned = returned.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (cleaned) {
    const maybe = resolve(outDir, cleaned);
    if (isWithinDirectory(safeRoot, maybe)) candidates.push(maybe);
    candidates.push(resolve(outDir, basename(cleaned)));
  }
  for (const entry of await readdir(outDir)) candidates.push(resolve(outDir, entry));
  for (const candidate of Array.from(new Set(candidates))) {
    if (!isWithinDirectory(safeRoot, candidate)) continue;
    const ext = extname(candidate).toLowerCase();
    if (!ALLOWED_IMAGE_EXTS.has(ext)) continue;
    const info = await stat(candidate).catch(() => null);
    if (info?.isFile() && info.size > 0) return candidate;
  }
  throw new Error("Codex CLI did not produce a PNG/JPG/JPEG/WEBP file.");
}
