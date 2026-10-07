// Minimal client for Ollama's native chat API. Only the backend talks to Ollama.
import { config } from "../config.js";

export type ChatMessage = { role: "system" | "user"; content: string };

// Callers map this to one generic response; `reason` is for server logs only.
export class AiUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`AI unavailable: ${reason}`);
  }
}

// Caps generation length on the Ollama side so a request cannot run on indefinitely.
const MAX_TOKENS = 300;

// `format` is Ollama's structured output: a JSON schema the reply must follow.
export async function chat(messages: ChatMessage[], format?: object): Promise<string> {
  const { baseUrl, model, timeoutMs } = config.ai;
  if (!baseUrl || !model) throw new AiUnavailableError("not configured");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(format ? { format } : {}),
        options: { temperature: 0.2, num_predict: MAX_TOKENS },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new AiUnavailableError(timedOut ? "timeout" : "unreachable");
  }

  if (!res.ok) {
    // Drain the body so the connection is released; its content is never forwarded.
    await res.body?.cancel().catch(() => {});
    throw new AiUnavailableError(`status ${res.status}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new AiUnavailableError(timedOut ? "timeout" : "invalid response");
  }
  const content = (json as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiUnavailableError("invalid response");
  return content.trim();
}
