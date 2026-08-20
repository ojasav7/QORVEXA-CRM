// LLM adapter (Phase 16 · ADR-028) — real OpenAI chat completions behind the
// existing model router. One narrow function, REST-over-fetch (no SDK), and
// the callers decide: `maybeCallLlm` (server/lib/ai.ts) returns null on ANY
// miss (no key, mock provider, network/parse error) so the deterministic
// generators are the fallback — a real model is a strict enhancement.
import { env } from "../../env";

export type ChatCompletionInput = {
  apiKey: string;
  baseUrl: string; // e.g. https://api.openai.com (or an OpenAI-compatible gateway)
  model: string; // the provider's model id
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
};

export type ChatCompletionResult = {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** POST /v1/chat/completions and return the first completion's content. */
export async function openaiChatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
  const res = await fetch(`${input.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.4,
      max_tokens: input.maxTokens ?? 400,
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new LlmError(`LLM API ${res.status}: ${text.slice(0, 300)}`);
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LlmError("LLM API returned non-JSON");
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new LlmError("LLM API returned no content");
  return {
    text: content.trim(),
    usage: {
      promptTokens: Number(data?.usage?.prompt_tokens) || undefined,
      completionTokens: Number(data?.usage?.completion_tokens) || undefined,
    },
  };
}
