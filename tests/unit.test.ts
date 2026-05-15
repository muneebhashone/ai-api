import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { isWithinDirectory } from "../src/lib/path-safety";
import { parseModelId } from "../src/providers/registry";
import { parseCodexModelEntries } from "../src/providers/codex";

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
