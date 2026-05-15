import type { ChatMessage } from "../lib/messages";
import type { Usage } from "../lib/openai-shape";

export interface Capabilities {
  text: boolean;
  /** Accepts image inputs in messages */
  imageInput: boolean;
  /** Can generate images */
  imageGeneration: boolean;
  /** Can generate video */
  videoGeneration: boolean;
  tools: boolean;
  streaming: boolean;
  jsonMode: boolean;
  reasoningEffort: boolean;
}

export const DEFAULT_CAPS: Capabilities = {
  text: true,
  imageInput: false,
  imageGeneration: false,
  videoGeneration: false,
  tools: false,
  streaming: false,
  jsonMode: false,
  reasoningEffort: false,
};

export interface ModelInfo {
  /** Namespaced id, e.g. "openrouter/anthropic/claude-sonnet-4.5" */
  id: string;
  /** Provider's native id, e.g. "anthropic/claude-sonnet-4.5" */
  nativeId: string;
  provider: string;
  capabilities: Capabilities;
  contextWindow?: number;
  description?: string;
}

export interface ChatRequest {
  /** Native model id (provider prefix already stripped). */
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string | string[];
  jsonMode?: boolean;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  extraParams?: Record<string, unknown>;
}

export interface ChatChunk {
  delta: string;
  message?: Record<string, unknown>;
  deltaExtra?: Record<string, unknown>;
  /** Set on the final chunk if known. */
  usage?: Usage;
  /** Set on the final chunk. */
  finishReason?: string;
}

export interface ImageRequest {
  /** Native model id. */
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  responseFormat?: "url" | "b64_json";
}

export interface ImageResultItem {
  url?: string;
  b64_json?: string;
}

export interface ImageResult {
  data: ImageResultItem[];
  created: number;
}

export interface HealthStatus {
  ok: boolean;
  detail?: string;
}

export interface Provider {
  id: string;
  capabilities: Capabilities;
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  generateImage?(req: ImageRequest): Promise<ImageResult>;
  healthCheck(): Promise<HealthStatus>;
}
