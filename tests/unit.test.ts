import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { isWithinDirectory } from "../src/lib/path-safety";
import { parseModelId } from "../src/providers/registry";
import { parseCodexModelEntries } from "../src/providers/codex";
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
