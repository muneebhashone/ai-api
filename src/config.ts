import { z } from "zod";

const optionalNonEmpty = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
const optionalReasoningEffort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["low", "medium", "high", "xhigh"]).optional()
);
const openRouterProviderSort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["latency", "throughput", "price", "none"]).default("latency")
);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  OPENROUTER_API_KEY: optionalNonEmpty,
  OPENROUTER_SITE_URL: optionalUrl,
  OPENROUTER_APP_NAME: optionalNonEmpty,
  OPENROUTER_PROVIDER_SORT: openRouterProviderSort,
  CLAUDE_CODE_BIN: optionalNonEmpty,
  CODEX_BIN: optionalNonEmpty,
  OPENCODE_BIN: optionalNonEmpty,
  CODEX_IMAGE_MODEL: optionalNonEmpty,
  CODEX_IMAGE_REASONING_EFFORT: optionalReasoningEffort,
  CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  LLM_LOG: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[config] invalid env:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  openrouter: {
    apiKey: parsed.data.OPENROUTER_API_KEY,
    siteUrl: parsed.data.OPENROUTER_SITE_URL,
    appName: parsed.data.OPENROUTER_APP_NAME,
    providerSort: parsed.data.OPENROUTER_PROVIDER_SORT,
  },
  bin: {
    claudeCode: parsed.data.CLAUDE_CODE_BIN || "claude",
    codex: parsed.data.CODEX_BIN || "codex",
    opencode: parsed.data.OPENCODE_BIN || "opencode",
  },
  codexImage: {
    model: parsed.data.CODEX_IMAGE_MODEL || "gpt-5.5",
    reasoningEffort: parsed.data.CODEX_IMAGE_REASONING_EFFORT,
  },
  timeouts: {
    cliMs: parsed.data.CLI_TIMEOUT_MS,
    openrouterMs: parsed.data.OPENROUTER_TIMEOUT_MS,
  },
  log: parsed.data.LLM_LOG !== "0",
};
