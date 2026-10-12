/**
 * OpenRouter client for the PYB chat agent.
 *
 * User decision: "use the free models router on openrouter."
 * Strategy: an ordered list of free models — try the first, fall back on
 * 429 (free-tier rate limits), 5xx, or "model not found" (404). OPENROUTER_API_KEY
 * in env only.
 *
 * Chain note: the planned head of the chain (z-ai/glm-*, qwen/qwen*:free) had
 * no `:free` SKUs in OpenRouter's live catalog when this shipped, and the
 * nemotron family 404s on this key ("guardrail restrictions") while the
 * inkling models are agentic-harness-only. The chain below was verified live
 * on 2026-10-12 against GET /api/v1/models + a tool-calling probe: gemma
 * (transient 429s — rolls through), apodex and north (tool calls confirmed),
 * dots as last resort. Unknown 404s/429s roll to the next model safely.
 */

const BASE = "https://openrouter.ai/api/v1";

export const FREE_MODELS = [
  "google/gemma-4-31b-it:free", // best chat quality, tool capable; upstream pool 429s at peak
  "apodex/apodex-1.1-mini:free", // verified: emits tool calls
  "cohere/north-mini-code:free", // verified: emits tool calls
  "dots-studio/dots-3-note-preview:free", // last resort: chats well, tools unreliable
] as const;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ORChoice {
  message?: { role?: string; content?: string | null; tool_calls?: ToolCall[] };
  delta?: {
    content?: string | null;
    tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string | null;
}

interface ORResponse {
  choices?: ORChoice[];
  error?: { message?: string };
}

export class OpenRouterError extends Error {}

function isRetryable(status: number): boolean {
  // 429 = free-tier rate limit; 404 = model not in catalog; 5xx = upstream.
  return status === 429 || status === 404 || status >= 500;
}

function key(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new OpenRouterError("OPENROUTER_API_KEY is not set");
  return k;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/json",
    // App attribution — some OpenRouter models gate on it, and it's good
    // citizenship on the shared free pool.
    "HTTP-Referer": "https://puckyobills.com",
    "X-Title": "Puck Yo Bills",
  };
}

/** Run `build` against each model in the fallback chain until one succeeds. */
async function withFallback<T>(
  build: (model: string) => Promise<Response>,
  handle: (res: Response, model: string) => Promise<T>,
): Promise<{ result: T; model: string }> {
  let lastErr: unknown = null;
  for (const model of FREE_MODELS) {
    let res: Response;
    try {
      res = await build(model);
    } catch (e) {
      lastErr = e; // network/timeout: try next model
      continue;
    }
    if (isRetryable(res.status)) {
      lastErr = new OpenRouterError(`openrouter ${model} -> ${res.status}`);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OpenRouterError(
        `openrouter ${model} -> ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    return { result: await handle(res, model), model };
  }
  throw new OpenRouterError(
    `all openrouter models failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/** Non-streaming completion, optionally with tools. */
export async function chatComplete(
  messages: ChatMessage[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    tools?: ToolDef[];
  } = {},
): Promise<{ text: string; toolCalls: ToolCall[]; model: string }> {
  const { result, model } = await withFallback(
    (m) =>
      fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model: opts.model ?? m,
          messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 1024,
          ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
        }),
        signal: AbortSignal.timeout(90_000),
      }),
    async (res) => {
      const data = (await res.json()) as ORResponse;
      const msg = data.choices?.[0]?.message;
      return {
        text: msg?.content ?? "",
        toolCalls: (msg?.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
    },
  );
  return { ...result, model };
}

/** SSE deltas from a streaming chat completion response body. */
async function* sseDeltas(res: Response): AsyncGenerator<NonNullable<ORChoice["delta"]>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
      // OpenRouter pads with ": OPENROUTER PROCESSING" comment lines.
      if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data) as { choices?: ORChoice[] };
        const delta = chunk.choices?.[0]?.delta;
        if (delta) yield delta;
      } catch {
        // skip malformed keepalive chunks
      }
    }
  }
}

/**
 * Streaming completion with the same fallback chain. Yields text deltas and
 * finishes with the accumulated tool calls, if the model decided to call
 * tools instead of answering (in which case nothing was yielded as text).
 */
export async function* streamChatComplete(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; tools?: ToolDef[] } = {},
): AsyncGenerator<
  { type: "text"; text: string } | { type: "done"; model: string; toolCalls: ToolCall[] }
> {
  let streamErr: unknown = null;

  outer: for (const model of FREE_MODELS) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 1024,
          ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      streamErr = e;
      continue; // network/timeout: try next model
    }
    if (isRetryable(res.status)) {
      streamErr = new OpenRouterError(`openrouter ${model} -> ${res.status}`);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OpenRouterError(`openrouter ${model} -> ${res.status}: ${body.slice(0, 300)}`);
    }

    let text = "";
    const acc: Record<number, ToolCall> = {};
    try {
      for await (const delta of sseDeltas(res)) {
        if (delta.content) {
          text += delta.content;
          yield { type: "text", text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const i = tc.index ?? 0;
          acc[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) acc[i].id = tc.id;
          if (tc.function?.name) acc[i].function.name += tc.function.name;
          if (tc.function?.arguments) acc[i].function.arguments += tc.function.arguments;
        }
      }
    } catch (e) {
      // Mid-stream failure after we already relayed text: surface it rather
      // than silently retrying (a retry would duplicate the visible text).
      throw new OpenRouterError(
        `openrouter ${model} stream broke mid-response: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const toolCalls = Object.keys(acc)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => acc[i]);

    // Some models emit tool calls with no id — synthesize one.
    for (const [i, tc] of toolCalls.entries()) {
      if (!tc.id) tc.id = `${model}-call-${i}`;
    }

    if (toolCalls.length === 0 && !text) {
      streamErr = new OpenRouterError(`openrouter ${model} returned an empty stream`);
      continue outer; // try next model
    }

    yield { type: "done", model, toolCalls };
    return;
  }
  throw new OpenRouterError(
    `all openrouter models failed: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
  );
}
