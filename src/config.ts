import { z } from "zod";

const optionalNonEmpty = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());
const optionalReasoningEffort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["low", "medium", "high", "xhigh"]).optional()
);
const optionalDeepSeekReasoningEffort = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["high", "max"]).optional()
);
const deepSeekThinkingDefault = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(["enabled", "disabled", "none"]).default("enabled")
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
  DEEPSEEK_API_KEY: optionalNonEmpty,
  DEEPSEEK_BASE_URL: optionalUrl.default("https://api.deepseek.com"),
  DEEPSEEK_DEFAULT_THINKING: deepSeekThinkingDefault,
  DEEPSEEK_DEFAULT_REASONING_EFFORT: optionalDeepSeekReasoningEffort.default("high"),
  CLAUDE_CODE_BIN: optionalNonEmpty,
  CODEX_BIN: optionalNonEmpty,
  OPENCODE_BIN: optionalNonEmpty,
  CODEX_IMAGE_MODEL: optionalNonEmpty,
  CODEX_IMAGE_REASONING_EFFORT: optionalReasoningEffort,
  CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
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
  deepseek: {
    apiKey: parsed.data.DEEPSEEK_API_KEY,
    baseUrl: parsed.data.DEEPSEEK_BASE_URL.replace(/\/+$/, ""),
    defaultThinking: parsed.data.DEEPSEEK_DEFAULT_THINKING,
    defaultReasoningEffort: parsed.data.DEEPSEEK_DEFAULT_REASONING_EFFORT,
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
    deepseekMs: parsed.data.DEEPSEEK_TIMEOUT_MS,
  },
  log: parsed.data.LLM_LOG !== "0",
};
