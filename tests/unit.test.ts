import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { isWithinDirectory } from "../src/lib/path-safety";
import { parseModelId } from "../src/providers/registry";
import { parseCodexModelEntries } from "../src/providers/codex";
import { buildDeepSeekChatBody, parseDeepSeekStreamPayload, shouldUseDeepSeekBeta } from "../src/providers/deepseek";
import { buildOpenRouterChatBody } from "../src/providers/openrouter";

describe("model ids", () => {
  test("parses provider prefix only once", () => {
    expect(parseModelId("openrouter/anthropic/claude-sonnet-4.5")).toEqual({
      providerId: "openrouter",
      nativeId: "anthropic/claude-sonnet-4.5",
    });
  });

  test("parses Codex debug models slug format", () => {
    const models = parseCodexModelEntries(JSON.stringify({
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5", description: "frontier" },
        { id: "gpt-5.3-codex-spark", name: "spark" },
      ],
    }));
    expect(models).toEqual([
      { id: "gpt-5.5", description: "frontier" },
      { id: "gpt-5.3-codex-spark", description: "spark" },
    ]);
  });
});

describe("path containment", () => {
  test("allows files below root", () => {
    const root = resolve("generated");
    expect(isWithinDirectory(root, resolve(root, "image.png"))).toBe(true);
  });

  test("rejects sibling prefix paths", () => {
    const root = resolve("generated");
    expect(isWithinDirectory(root, resolve("generated-other", "image.png"))).toBe(false);
  });
});

describe("OpenRouter prompt caching", () => {
  test("enables Anthropic automatic prompt caching by default", () => {
    const body = buildOpenRouterChatBody({
      model: "anthropic/claude-sonnet-4.6",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });

    expect(body.cache_control).toEqual({ type: "ephemeral" });
  });

  test("preserves caller-provided cache control", () => {
    const body = buildOpenRouterChatBody({
      model: "anthropic/claude-sonnet-4.6",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      extraParams: { cache_control: { type: "ephemeral", ttl: "1h" } },
    });

    expect(body.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  test("does not add explicit cache control for providers with implicit caching", () => {
    const body = buildOpenRouterChatBody({
      model: "openai/gpt-4.1",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });

    expect(body.cache_control).toBeUndefined();
  });
});

describe("OpenRouter provider routing", () => {
  test("sorts providers by latency by default", () => {
    const body = buildOpenRouterChatBody({
      model: "openai/gpt-4.1",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });

    expect(body.provider).toEqual({ sort: "latency" });
  });

  test("preserves caller-provided provider routing", () => {
    const body = buildOpenRouterChatBody({
      model: "openai/gpt-4.1",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      extraParams: { provider: { sort: "throughput", allow_fallbacks: true } },
    });

    expect(body.provider).toEqual({ sort: "throughput", allow_fallbacks: true });
  });
});

describe("DeepSeek defaults", () => {
  test("enables thinking and high reasoning by default", () => {
    const body = buildDeepSeekChatBody({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });

    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
  });

  test("preserves caller-provided thinking, reasoning, stream options, and tools", () => {
    const tools = [{ type: "function", function: { name: "lookup", strict: true } }];
    const body = buildDeepSeekChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      extraParams: {
        thinking: { type: "disabled" },
        reasoning_effort: "max",
        stream_options: { include_usage: false },
        tools,
      },
    });

    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBe("max");
    expect(body.stream_options).toEqual({ include_usage: false });
    expect(body.tools).toBe(tools);
  });

  test("does not add reasoning effort when thinking is explicitly disabled", () => {
    const body = buildDeepSeekChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      extraParams: { thinking: { type: "disabled" } },
    });

    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  test("maps gateway reasoning aliases to DeepSeek-supported efforts", () => {
    expect(buildDeepSeekChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      reasoningEffort: "low",
    }).reasoning_effort).toBe("high");

    expect(buildDeepSeekChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      reasoningEffort: "xhigh",
    }).reasoning_effort).toBe("max");
  });

  test("adds include_usage for streams by default", () => {
    const body = buildDeepSeekChatBody({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    });

    expect(body.stream_options).toEqual({ include_usage: true });
  });

  test("selects beta endpoint for prefix completion and strict tools", () => {
    expect(shouldUseDeepSeekBeta({
      model: "deepseek-v4-pro",
      messages: [{ role: "assistant", content: "", prefix: true } as any],
      stream: false,
    })).toBe(true);

    expect(shouldUseDeepSeekBeta({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      extraParams: { tools: [{ type: "function", function: { name: "lookup", strict: true } }] },
    })).toBe(true);
  });
});

describe("DeepSeek stream parsing", () => {
  test("parses content deltas", () => {
    const chunk = parseDeepSeekStreamPayload(JSON.stringify({
      choices: [{ delta: { content: "hello" }, finish_reason: null }],
    }));

    expect(chunk).toEqual({ delta: "hello", deltaExtra: {}, finishReason: undefined, usage: undefined });
  });

  test("preserves reasoning deltas", () => {
    const chunk = parseDeepSeekStreamPayload(JSON.stringify({
      choices: [{ delta: { reasoning_content: "thinking" }, finish_reason: null }],
    }));

    expect(chunk?.delta).toBe("");
    expect(chunk?.deltaExtra).toEqual({ reasoning_content: "thinking" });
  });

  test("parses final usage-only chunks", () => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_cache_hit_tokens: 3,
      prompt_cache_miss_tokens: 7,
      completion_tokens_details: { reasoning_tokens: 2 },
    };
    const chunk = parseDeepSeekStreamPayload(JSON.stringify({ choices: [], usage }));

    expect(chunk?.usage).toEqual(usage);
  });
});
