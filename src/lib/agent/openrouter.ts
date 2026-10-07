/**
 * OpenRouter client for the PYB chat agent.
 *
 * User decision: "use the free models router on openrouter."
 * Strategy: a small ordered list of free models — try the first, fall back
 * on 429 (free-tier rate limits) or 5xx. OPENROUTER_API_KEY in env only.
 */

const BASE = "https://openrouter.ai/api/v1";

export const FREE_MODELS = [
  "z-ai/glm-5.2:free", // strong general chat, 32k ctx
  "qwen/qwen3.8-27b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
] as const;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ORChoice {
  message?: { role?: string; content?: string };
}

interface ORResponse {
  choices?: ORChoice[];
  error?: { message?: string };
}

export class OpenRouterError extends Error {}

export async function chatComplete(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; model?: string } = {},
): Promise<{ text: string; model: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterError("OPENROUTER_API_KEY is not set");

  const models = opts.model ? [opts.model, ...FREE_MODELS] : [...FREE_MODELS];
  let lastErr: unknown = null;

  for (const model of models) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 1024,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new OpenRouterError(`openrouter ${model} -> ${res.status}`);
        continue; // try next model in the fallback chain
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new OpenRouterError(`openrouter ${model} -> ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as ORResponse;
      const text = data.choices?.[0]?.message?.content ?? "";
      return { text, model };
    } catch (e) {
      if (e instanceof OpenRouterError && e.message.startsWith("openrouter") && res429ish(e)) lastErr = e;
      else lastErr = e;
      // network/timeout: also try next model
    }
  }
  throw new OpenRouterError(
    `all openrouter models failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function res429ish(e: OpenRouterError): boolean {
  return /\b(429|5\d\d)\b/.test(e.message);
}
