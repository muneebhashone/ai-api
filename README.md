# ai-api

**One OpenAI-compatible endpoint for every model you already pay for.**

ai-api is a lightweight gateway that sits in front of hosted APIs and local CLIs, exposing them all through the same `/v1/*` surface your tools already speak. Point any OpenAI SDK at it, pick a namespaced model id, and ship.

Built on [Bun](https://bun.sh) + [Elysia](https://elysiajs.com). Fast to run, small to deploy, easy to extend.

```
┌─────────────────┐     OpenAI wire format      ┌──────────────────────────────┐
│  Your app / SDK │ ──────────────────────────► │  ai-api  (localhost:3000)   │
└─────────────────┘                             └──────────────┬───────────────┘
                                                               │
           ┌───────────────────────────────────────────────────┼────────────────────────┐
           │                                                   │                        │
           ▼                                                   ▼                        ▼
   ┌───────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────┐   ┌────────────┐
   │  OpenRouter   │   │   DeepSeek   │   │ Claude Code │   │  Codex   │   │  OpenCode  │
   │  (HTTP API)   │   │  (HTTP API)  │   │   (CLI)     │   │  (CLI)   │   │   (CLI)    │
   └───────────────┘   └──────────────┘   └─────────────┘   └──────────┘   └────────────┘
```

## Why ai-api?

Most teams end up juggling multiple AI backends: an OpenRouter key for hosted models, Claude Code or Codex for subscription access, OpenCode for local agents, and a pile of SDK-specific config. ai-api unifies them behind one local HTTP server.

- **Drop-in compatibility** — Works with the official OpenAI SDKs, LangChain, Cursor-style clients, curl, and anything else that hits `/v1/chat/completions`.
- **Namespaced model IDs** — Route by prefix: `openrouter/anthropic/claude-sonnet-4.5`, `deepseek/deepseek-v4-flash`, `codex/gpt-5`, `claude-code/claude-sonnet-4-6`, `opencode/...`.
- **CLI providers as HTTP** — Wrap `claude`, `codex`, and `opencode` binaries so local tools become normal API calls.
- **Streaming first** — SSE token streaming normalized to OpenAI delta chunks with `[DONE]` sentinels.
- **Image generation** — `/v1/images/generations` via Codex, with assets served from `/generated/*`.
- **Live OpenAPI** — Interactive docs at `/openapi`, generated from route definitions.

## Quick start

**Requirements:** [Bun](https://bun.sh) 1.x

```bash
git clone https://github.com/muneebhashone/ai-api.git
cd ai-api
cp .env.example .env
bun install
bun run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) for the landing page, or hit the API directly:

```bash
curl http://127.0.0.1:3000/v1/models
curl http://127.0.0.1:3000/v1/providers
curl http://127.0.0.1:3000/healthz
```

### Chat completion

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/anthropic/claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Summarize ai-api in one sentence."}]
  }'
```

Streaming:

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/openai/gpt-4.1",
    "stream": true,
    "messages": [{"role": "user", "content": "Count to five."}]
  }'
```

### Use with the OpenAI SDK

**TypeScript**

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:3000/v1",
  apiKey: "not-needed-locally",
});

const res = await client.chat.completions.create({
  model: "deepseek/deepseek-v4-flash",
  messages: [{ role: "user", content: "Write a launch checklist." }],
});

console.log(res.choices[0].message.content);
```

**Python**

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:3000/v1", api_key="not-needed-locally")

stream = client.chat.completions.create(
    model="codex/gpt-5",
    stream=True,
    messages=[{"role": "user", "content": "Explain SSE in one paragraph."}],
)

for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

## Providers

| Provider | Type | Model prefix | Notes |
|----------|------|--------------|-------|
| **OpenRouter** | HTTP | `openrouter/` | Full hosted catalog. Anthropic models get automatic prompt caching. Default provider sort: latency. |
| **DeepSeek** | HTTP | `deepseek/` | Native DeepSeek API. Thinking mode enabled by default with high reasoning effort. |
| **Claude Code** | CLI | `claude-code/` | Anthropic's coding CLI behind an OpenAI endpoint. |
| **Codex** | CLI | `codex/` | OpenAI's coding CLI. Also powers image generation. |
| **OpenCode** | CLI | `opencode/` | Open-source agentic coder, callable from any OpenAI client. |

Model ids are always `provider/native-id`. For OpenRouter, the native id includes the upstream vendor path (e.g. `anthropic/claude-sonnet-4.5`).

Check what's available:

```bash
curl http://127.0.0.1:3000/v1/providers
curl http://127.0.0.1:3000/v1/providers/openrouter/models
```

## API surface

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Chat completion (streaming and non-streaming) |
| `POST` | `/v1/images/generations` | Image generation (Codex) |
| `GET` | `/v1/models` | Aggregated model catalog |
| `GET` | `/v1/models/:id` | Single model metadata |
| `GET` | `/v1/providers` | Provider health and capabilities |
| `GET` | `/v1/providers/:id/models` | Models for one provider |
| `GET` | `/openapi` | OpenAPI spec + interactive docs |
| `GET` | `/healthz` | Liveness probe (`{ ok: true }`) |
| `GET` | `/generated/*` | Static serve for generated images |

Errors are returned in OpenAI-compatible shape.

## Configuration

Copy `.env.example` to `.env` and set what you need. Providers without credentials or binaries still register — they just report unhealthy until configured.

```env
PORT=3000

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_SITE_URL=http://localhost
OPENROUTER_APP_NAME=ai-api-gateway
OPENROUTER_PROVIDER_SORT=latency   # latency | throughput | price | none

# DeepSeek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_DEFAULT_THINKING=enabled  # enabled | disabled | none
DEEPSEEK_DEFAULT_REASONING_EFFORT=high  # high | max

# Local CLIs (defaults: claude, codex, opencode on PATH)
CLAUDE_CODE_BIN=
CODEX_BIN=
OPENCODE_BIN=

# Codex image generation
CODEX_IMAGE_MODEL=gpt-5.5
CODEX_IMAGE_REASONING_EFFORT=

# Timeouts (ms)
CLI_TIMEOUT_MS=600000
OPENROUTER_TIMEOUT_MS=600000
DEEPSEEK_TIMEOUT_MS=600000

# Logging — set to 0 to silence per-call logs
LLM_LOG=1
```

### Provider-specific notes

**OpenRouter** — Requests default to `provider.sort = "latency"` when the caller does not supply a `provider` object. Override with `OPENROUTER_PROVIDER_SORT=throughput`, `price`, or `none`.

**DeepSeek** — Chat requests default to thinking mode with `reasoning_effort = "high"`. Override per request with `reasoning_effort`, or set `DEEPSEEK_DEFAULT_THINKING=disabled` / `none` and `DEEPSEEK_DEFAULT_REASONING_EFFORT=max` in the environment.

**CLI providers** — Require the respective binary installed and authenticated. The gateway spawns them as child processes and translates stdin/stdout into OpenAI-shaped responses.

## Development

```bash
bun run dev        # watch mode
bun test           # unit tests
bun run typecheck  # TypeScript
```

Project layout:

```
src/
  index.ts           # server entry + static routes
  config.ts          # env parsing
  routes/            # /v1/* handlers
  providers/         # provider adapters
  lib/               # OpenAI shape, SSE, CLI spawn, etc.
public/index.html    # landing page
tests/               # unit tests
```

## License

MIT
