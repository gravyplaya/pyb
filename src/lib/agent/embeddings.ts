/**
 * OpenRouter embeddings client for the PYB RAG layer.
 *
 * The chat key already lives in OPENROUTER_API_KEY; OpenRouter's
 * OpenAI-compatible /embeddings endpoint serves the embedding models. The
 * :free embedding SKUs are blocked on this key ("guardrail restrictions"),
 * but the small paid ones cost fractions of a cent for the entire bill
 * index — ~$0.003 for 3,300 bills with gte-base.
 *
 * Chain note: every model in the list is 768-dim on purpose — the
 * bill_embeddings column is vector(768), so a fallback must produce
 * comparable vectors. If OpenRouter retires one, the next takes over and
 * the embedder re-embeds pending rows (model is recorded per row).
 */

const BASE = "https://openrouter.ai/api/v1";

export const EMBED_MODELS = [
  "thenlper/gte-base", // verified live on 2026-10-12: 768 dims, ~$0.000000005/token
  "intfloat/e5-base-v2", // same space family, 768 dims
  "sentence-transformers/all-mpnet-base-v2", // 768 dims
  "baai/bge-base-en-v1.5", // 768 dims
] as const;

export const EMBED_DIM = 768;
// OpenAI-compatible input accepts arrays; 64 short texts per request keeps
// the free/paid pools happy and each request well under payload limits.
export const EMBED_BATCH = 64;

export class EmbeddingError extends Error {}

function key(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new EmbeddingError("OPENROUTER_API_KEY is not set");
  return k;
}

function isRetryable(status: number): boolean {
  // 429 = rate limit; 404 = model unavailable on this key; 5xx = upstream.
  return status === 429 || status === 404 || status >= 500;
}

/** Embed a batch of texts. Returns the vectors in input order plus the model
 * that produced them (the caller records it per row). Rolls through the
 * chain on 429/404/5xx/network, same policy as the chat client. A
 * `preferModel` (e.g. the model already in the vector store) is tried
 * first so query vectors live in the same space as the stored ones. */
export async function embedTexts(
  texts: string[],
  opts: { preferModel?: string } = {},
): Promise<{ vectors: number[][]; model: string }> {
  if (texts.length === 0) return { vectors: [], model: "" };
  if (texts.length > EMBED_BATCH) {
    throw new EmbeddingError(`batch of ${texts.length} exceeds EMBED_BATCH ${EMBED_BATCH}`);
  }
  const { preferModel } = opts;
  const chain: readonly string[] = preferModel && EMBED_MODELS.includes(preferModel as never)
    ? [preferModel, ...EMBED_MODELS.filter((m) => m !== preferModel)]
    : EMBED_MODELS;
  let lastErr: unknown = null;
  for (const model of chain) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://puckyobills.com",
          "X-Title": "Puck Yo Bills",
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (isRetryable(res.status)) {
      lastErr = new EmbeddingError(`openrouter embeddings ${model} -> ${res.status}`);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new EmbeddingError(
        `openrouter embeddings ${model} -> ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      data?: { index?: number; embedding?: number[] }[];
    };
    const items = data.data ?? [];
    if (items.length !== texts.length) {
      lastErr = new EmbeddingError(
        `openrouter embeddings ${model}: got ${items.length} vectors for ${texts.length} inputs`,
      );
      continue;
    }
    // Restore input order and validate the dimension — a wrong-dim vector
    // would break the vector(768) column.
    const byIndex = new Map<number, number[]>();
    for (const item of items) {
      if (item.embedding?.length !== EMBED_DIM) {
        lastErr = new EmbeddingError(
          `openrouter embeddings ${model}: vector has ${item.embedding?.length} dims, expected ${EMBED_DIM}`,
        );
        byIndex.clear();
        break;
      }
      byIndex.set(item.index ?? byIndex.size, item.embedding);
    }
    if (byIndex.size !== texts.length) continue;
    const vectors = texts.map((_, i) => byIndex.get(i)!);
    return { vectors, model };
  }
  throw new EmbeddingError(
    `all embedding models failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/** Embed one text (query-time convenience over embedTexts). */
export async function embedText(
  text: string,
  opts: { preferModel?: string } = {},
): Promise<{ vector: number[]; model: string }> {
  const { vectors, model } = await embedTexts([text], opts);
  return { vector: vectors[0], model };
}
