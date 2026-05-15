/**
 * Encode an event as an OpenAI-style SSE frame.
 * The OpenAI streaming spec uses `data: <json>\n\n` and a final `data: [DONE]\n\n`.
 */
export function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
