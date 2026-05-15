import { randomUUID } from "node:crypto";

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChoiceMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: unknown;
  function_call?: unknown;
  refusal?: string | null;
}

export function newCompletionId(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, "")}`;
}

export function buildChatCompletion(opts: {
  id: string;
  model: string;
  content: string;
  usage?: Usage;
  finishReason?: string;
  message?: Partial<ChoiceMessage>;
}) {
  const message = opts.message
    ? { role: "assistant" as const, content: opts.content, ...opts.message }
    : { role: "assistant" as const, content: opts.content };
  return {
    id: opts.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: opts.finishReason ?? "stop",
      },
    ],
    usage: opts.usage,
  };
}

export function buildChunk(opts: {
  id: string;
  model: string;
  delta: string;
  role?: "assistant";
  finishReason?: string | null;
  usage?: Usage;
  deltaExtra?: Record<string, unknown>;
}) {
  const delta = opts.role
    ? { role: opts.role, content: opts.delta, ...(opts.deltaExtra ?? {}) }
    : { content: opts.delta, ...(opts.deltaExtra ?? {}) };
  return {
    id: opts.id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: opts.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: opts.finishReason ?? null,
      },
    ],
    ...(opts.usage ? { usage: opts.usage } : {}),
  };
}

/**
 * Robust JSON extraction: handles fenced blocks and prose-wrapped JSON.
 * Ported from auren-content/lib/llm/index.ts.
 */
export function extractJson<T>(raw: string): T | undefined {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());
  candidates.push(
    raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
  );
  const balanced = findBalanced(raw);
  if (balanced) candidates.push(balanced);
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c) as T;
    } catch {
      // try next
    }
  }
  return undefined;
}

function findBalanced(s: string): string | null {
  for (let start = 0; start < s.length; start++) {
    const ch = s[start];
    if (ch !== "{" && ch !== "[") continue;
    const open = ch;
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inStr) {
        if (c === "\\") {
          escape = true;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
  }
  return null;
}
