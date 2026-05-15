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
