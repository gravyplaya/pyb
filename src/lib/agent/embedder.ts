/**
 * Embeddings pipeline: cached bill summaries (fallback: titles) →
 * bill_embeddings, kept fresh as the poller syncs.
 *
 * - Pending scan: any bill whose embedding row is missing or whose
 *   summary/title changed since it was embedded (content-hash check).
 *   The lazy summary fetch in bills.ts updates summary_text, so a bill
 *   picked up by the poller as title-only gets re-embedded with its
 *   summary once that arrives — no extra hook needed.
 * - Backfill: at boot (and via scripts/embed-backfill.ts) the whole
 *   pending set, in batches.
 * - Incremental: every 10 minutes the embedder flushes up to 256 pending
 *   bills — plenty for a 15-min poller window of new/updated bills.
 *
 * Best-effort by design: an embedding outage never blocks the poller or
 * the chat (the hybrid search falls back to keyword search).
 */

import { createHash } from "node:crypto";
import { query, tx } from "@/lib/db";
import { EMBED_BATCH, embedTexts } from "./embeddings";

// Embedding content and hash must match the SQL pending scan exactly:
// the summary when Congress.gov has one, else the title; md5 of that.
export function embeddingContent(title: string, summary: string | null): string {
  return summary && summary.trim() ? summary : title;
}

function contentHash(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

const PENDING_WHERE = `
  FROM bills b
  LEFT JOIN bill_embeddings e
    ON e.congress = b.congress AND e.bill_type = b.bill_type AND e.number = b.number
  WHERE e.number IS NULL
     OR e.content_hash <> md5(COALESCE(NULLIF(b.summary_text, ''), b.title))`;

export interface EmbedFlushResult {
  batches: number;
  embedded: number;
  failedBatches: number;
  pendingRemaining: number;
}

/** Bills needing (re-)embedding: no row, or summary/title changed since. */
async function fetchPending(limit: number): Promise<
  {
    congress: number;
    bill_type: string;
    number: string;
    content: string;
    source: "summary" | "title";
  }[]
> {
  const rows = await query<Record<string, unknown>>(
    `SELECT b.congress, b.bill_type, b.number, b.title,
            COALESCE(NULLIF(b.summary_text, ''), '') AS summary
     ${PENDING_WHERE}
     LIMIT $1`,
    [limit],
  );
  return rows.rows.map((r) => {
    const title = String(r.title);
    const summary = r.summary ? String(r.summary) : null;
    return {
      congress: Number(r.congress),
      bill_type: String(r.bill_type),
      number: String(r.number),
      content: embeddingContent(title, summary),
      source: summary ? ("summary" as const) : ("title" as const),
    };
  });
}

/**
 * Embed up to `maxBills` pending bills. A failed batch aborts the flush
 * (the next tick retries); the pending count tells the caller what's left.
 */
export async function embedPending(maxBills = 256): Promise<EmbedFlushResult> {
  const result: EmbedFlushResult = { batches: 0, embedded: 0, failedBatches: 0, pendingRemaining: 0 };
  let remaining = maxBills;
  while (remaining > 0) {
    const pending = await fetchPending(Math.min(EMBED_BATCH, remaining));
    if (pending.length === 0) break;
    try {
      const { vectors, model } = await embedTexts(pending.map((p) => p.content));
      await tx(async (client) => {
        for (let i = 0; i < pending.length; i++) {
          const p = pending[i];
          await client.query(
            `INSERT INTO bill_embeddings (congress, bill_type, number, model, source, content_hash, embedding)
             VALUES ($1,$2,$3,$4,$5,$6,$7::vector)
             ON CONFLICT (congress, bill_type, number) DO UPDATE SET
               model = EXCLUDED.model,
               source = EXCLUDED.source,
               content_hash = EXCLUDED.content_hash,
               embedding = EXCLUDED.embedding,
               embedded_at = now()`,
            [
              p.congress,
              p.bill_type,
              p.number,
              model,
              p.source,
              contentHash(p.content),
              toVectorLiteral(vectors[i]),
            ],
          );
        }
      });
      result.batches++;
      result.embedded += pending.length;
    } catch (e) {
      console.error("[pyb-embed] batch failed:", e);
      result.failedBatches++;
      break;
    }
    remaining -= pending.length;
    if (pending.length < EMBED_BATCH) break; // scan exhausted
  }
  const left = await query<{ count: string }>(
    `SELECT count(*)::text AS count ${PENDING_WHERE}`,
  );
  result.pendingRemaining = Number(left.rows[0]?.count ?? "0");
  return result;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

/** Starts the embedder: full backfill at boot, then a 10-min flush loop. */
export function startEmbedder(): void {
  if (timer) return;
  const tick = async (maxBills: number) => {
    if (flushing) return;
    flushing = true;
    try {
      const r = await embedPending(maxBills);
      if (r.embedded || r.failedBatches) {
        console.log(
          `[pyb-embed] embedded=${r.embedded} batches=${r.batches} failed=${r.failedBatches} pendingLeft=${r.pendingRemaining}`,
        );
      }
    } catch (e) {
      console.error("[pyb-embed] flush failed:", e);
    } finally {
      flushing = false;
    }
  };
  setTimeout(() => void tick(6000), 5000); // full backfill 5s after boot
  timer = setInterval(() => void tick(256), 10 * 60 * 1000);
  console.log("[pyb-embed] embedder started (backfill at boot, 10 min flush)");
}
