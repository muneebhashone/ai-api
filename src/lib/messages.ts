export type ChatMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | Record<string, unknown>;

export interface ChatMessage {
  role: string;
  content?: string | ChatMessageContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
  function_call?: unknown;
}

/**
 * Flatten OpenAI-style messages into a single prompt string for CLI providers
 * that don't accept structured chat input.
 */
export function flattenMessages(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const label = m.role === "system" ? "SYSTEM" : m.role.toUpperCase();
    if (typeof m.content === "string") {
      parts.push(`${label}:\n${m.content}`);
    } else if (Array.isArray(m.content)) {
      const text = m.content
        .map((c) => {
          if (c.type === "text" && typeof c.text === "string") return c.text;
          if (c.type === "image_url" && typeof c.image_url === "object" && c.image_url && "url" in c.image_url) {
            return `[image: ${String(c.image_url.url)}]`;
          }
          return `[${String(c.type ?? "content_part")}: ${JSON.stringify(c)}]`;
        })
        .join("\n");
      parts.push(`${label}:\n${text}`);
    } else if (m.tool_calls || m.function_call) {
      parts.push(`${label}:\n${JSON.stringify({ tool_calls: m.tool_calls, function_call: m.function_call })}`);
    } else if (m.tool_call_id) {
      parts.push(`${label} ${m.tool_call_id}:\n${m.content ?? ""}`);
    }
  }
  return parts.join("\n\n");
}
