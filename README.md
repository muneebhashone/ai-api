# Elysia with Bun runtime

## Getting Started
To get started with this template, simply paste this command into your terminal:
```bash
bun create elysia ./elysia-example
```

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.

## OpenRouter tuning

OpenRouter requests default to `provider.sort = "latency"` when the caller does not provide a `provider` object. Override with `OPENROUTER_PROVIDER_SORT=throughput`, `price`, or `none`.

## DeepSeek provider

Set `DEEPSEEK_API_KEY` to enable the native DeepSeek provider. Models are exposed with gateway ids such as `deepseek/deepseek-v4-flash` and `deepseek/deepseek-v4-pro`.

DeepSeek chat requests default to thinking mode enabled with `reasoning_effort = "high"` for better consumer output. Override per request with `reasoning_effort`, or set `DEEPSEEK_DEFAULT_THINKING=disabled` / `none` and `DEEPSEEK_DEFAULT_REASONING_EFFORT=max` in the environment.

Example:

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"Write a concise launch checklist"}]}'
```
