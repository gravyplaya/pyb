/**
 * Read-side bill queries. All pages read from the DB; detail JSON and
 * plain-language summaries are fetched lazily from Congress.gov and cached
 * in `bills` so the API is hit once per bill, not once per page view.
 */

import { query } from "@/lib/db";
import { congress as congressApi } from "@/lib/congress/client";
import { embedText } from "@/lib/agent/embeddings";

export interface BillRow {
  congress: number;
  bill_type: string;
  number: string;
  title: string;
  origin_chamber: string;
  introduced_date: string;
  latest_action_date: string | null;
  latest_action_text: string | null;
  update_date: string;
}

function pgToIso(d: Date | string | null): string | null {
  if (d == null) return null;
  return typeof d === "string" ? d : d.toISOString();
}

const BASE_SELECT = `SELECT congress, bill_type, number, title, origin_chamber,
  introduced_date, latest_action_date, latest_action_text, update_date
  FROM bills`;

/** Bills with activity since `since` (ISO), newest update first. */
export async function billsSince(since?: string, limit = 50, offset = 0): Promise<BillRow[]> {
  const rows = await query<Record<string, unknown>>(
    since
      ? `${BASE_SELECT} WHERE update_date >= $1 ORDER BY update_date DESC LIMIT $2 OFFSET $3`
      : `${BASE_SELECT} ORDER BY update_date DESC LIMIT $1 OFFSET $2`,
    since ? [since, limit, offset] : [limit, offset],
  );
  return rows.rows.map(mapRow);
}

/** Title keyword search for the chat agent's search_bills tool. */
export async function searchBills(q: string, limit = 8): Promise<BillRow[]> {
  // Escape ILIKE wildcards so model/user input matches literally.
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await query<Record<string, unknown>>(
    `${BASE_SELECT} WHERE title ILIKE $1 ORDER BY update_date DESC LIMIT $2`,
    [`%${escaped}%`, limit],
  );
  return rows.rows.map(mapRow);
}

/**
 * Bills whose latest action falls inside the look-back window, newest action
 * first — the chat agent's "what happened in the Senate today" tool.
 */
export async function recentActions(
  opts: { chamber?: string | null; days?: number; limit?: number } = {},
): Promise<BillRow[]> {
  const { chamber = null, days = 3, limit = 12 } = opts;
  const clauses = [`latest_action_date >= now()::date - $1::int`];
  const vals: unknown[] = [days];
  if (chamber) {
    vals.push(chamber);
    clauses.push(`origin_chamber = $${vals.length}`);
  }
  vals.push(limit);
  const rows = await query<Record<string, unknown>>(
    `${BASE_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY latest_action_date DESC, update_date DESC LIMIT $${vals.length}`,
    vals,
  );
  return rows.rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): BillRow {
  return {
    congress: Number(r.congress),
    bill_type: String(r.bill_type),
    number: String(r.number),
    title: String(r.title),
    origin_chamber: String(r.origin_chamber),
    introduced_date: pgToIso(r.introduced_date as string | Date)?.slice(0, 10) ?? "",
    latest_action_date: pgToIso(r.latest_action_date as string | null)?.slice(0, 10) ?? null,
    latest_action_text: r.latest_action_text == null ? null : String(r.latest_action_text),
    update_date: pgToIso(r.update_date as Date | string) ?? "",
  };
}

/** Bill detail: DB row + full detail JSON, fetched lazily and cached. */
export async function billDetail(congress: number, type: string, number: string) {
  const rows = await query<Record<string, unknown>>(
    `SELECT congress, bill_type, number, title, origin_chamber, introduced_date,
            latest_action_date, latest_action_text, update_date, detail_json, summary_text
     FROM bills WHERE congress = $1 AND bill_type = $2 AND number = $3`,
    [congress, type, number],
  );
  const row = rows.rows[0];
  if (!row) return null;

  let detailJson = row.detail_json as Record<string, unknown> | null;
  let summaryText = row.summary_text as string | null;

  // Lazy fetch + cache: at most one Congress.gov call per bill per process.
  if (!detailJson) {
    try {
      const [detail, summaries] = await Promise.all([
        congressApi.billDetail(congress, type, number),
        congressApi.billSummaries(congress, type, number).catch(() => null),
      ]);
      detailJson = (detail?.bill ?? null) as Record<string, unknown> | null;
      // Keep only the most recent summary version, not all of them:
      // HR 1's full join was 600KB; one version is what the agent needs.
      const summariesList = summaries?.summaries ?? [];
      summaryText = summariesList.length
        ? (summariesList[0].text ?? null)
        : null;
      await query(
        `UPDATE bills SET detail_json = $1, summary_text = $2, fetched_at = now()
         WHERE congress = $3 AND bill_type = $4 AND number = $5`,
        [JSON.stringify(detailJson), summaryText, congress, type, number],
      );
    } catch (e) {
      console.error("[pyb] lazy detail fetch failed:", e);
    }
  }

  return {
    ...mapRow(row),
    detail: detailJson,
    summary_text: summaryText,
  };
}

/**
 * Our own "most-viewed" replacement: a trending score from real data —
 * recency of latest action × action volume (actions count from detail JSON
 * once fetched; falls back to a recency-only score until then).
 */
export async function trendingBills(limit = 10) {
  const rows = await query<Record<string, unknown>>(
    `SELECT congress, bill_type, number, title, origin_chamber, introduced_date,
            latest_action_date, latest_action_text, update_date,
            (detail_json->'actions'->>'count')::int AS action_count
     FROM bills
     WHERE latest_action_date >= now()::date - interval '30 days'
     ORDER BY latest_action_date DESC, update_date DESC
     LIMIT $1`,
    [limit],
  );
  return rows.rows.map(mapRow);
}

// ---------------------------------------------------------------------------
// Hybrid search (Phase 4): semantic over the pgvector embeddings, blended
// with keyword search, so topical questions find relevant bills even when
// no keyword matches a title — and the answers cite real bill numbers.
// ---------------------------------------------------------------------------

export interface HybridBill extends BillRow {
  similarity: number | null;
  source: string | null;
}

const SEMANTIC_POOL = 24; // candidates from the vector leg before blending
const KEYWORD_POOL = 15; // candidates from the keyword leg before blending
const RRF_K = 60;
// An explicit bill-number reference in the query ("H.R. 1") pins that bill.
const BILL_REF_SCORE = 10;

function parseBillRefs(q: string): { type: string; number: string }[] {
  const refs: { type: string; number: string }[] = [];
  for (const m of q.matchAll(/\b(H\.?R\.?|S\.?)\s*(\d+)\b/gi)) {
    refs.push({ type: m[1].toUpperCase().startsWith("H") ? "hr" : "s", number: m[2] });
  }
  return refs;
}

/**
 * Semantic search over the bill embeddings. The query is embedded with the
 * model that dominates the vector store, so query and stored vectors live
 * in the same space even after a fallback embed.
 */
async function semanticSearch(
  q: string,
  limit: number,
): Promise<HybridBill[]> {
  const dom = await query<{ model: string }>(
    `SELECT model FROM bill_embeddings GROUP BY model ORDER BY count(*) DESC LIMIT 1`,
  );
  const preferred = dom.rows[0]?.model;
  const { vector } = await embedText(q, { preferModel: preferred });
  const rows = await query<Record<string, unknown>>(
    `SELECT b.congress, b.bill_type, b.number, b.title, b.origin_chamber,
            b.introduced_date, b.latest_action_date, b.latest_action_text, b.update_date,
            e.source, 1 - (e.embedding <=> $2::vector) AS similarity
     FROM bill_embeddings e
     JOIN bills b USING (congress, bill_type, number)
     WHERE e.model = $1
     ORDER BY e.embedding <=> $2::vector
     LIMIT $3`,
    [preferred ?? "", `[${vector.join(",")}]`, limit],
  );
  return rows.rows.map((r) => ({
    ...mapRow(r),
    similarity: r.similarity == null ? null : Number(r.similarity),
    source: r.source == null ? null : String(r.source),
  }));
}

/**
 * Hybrid search: semantic + keyword legs blended with reciprocal-rank
 * fusion, explicit bill-number references pinned to the top. Falls back to
 * keyword-only when the vector store is empty or the embedding API is down.
 */
export async function hybridSearchBills(q: string, limit = 8): Promise<HybridBill[]> {
  const refs = parseBillRefs(q);
  const keyword = await searchBills(q, KEYWORD_POOL).catch(() => [] as BillRow[]);

  let semantic: HybridBill[] = [];
  try {
    semantic = await semanticSearch(q, SEMANTIC_POOL);
  } catch (e) {
    console.error("[pyb] semantic search failed (falling back to keyword):", e);
  }

  if (semantic.length === 0) {
    return keyword.slice(0, limit).map((r) => ({ ...r, similarity: null, source: null }));
  }

  // Reciprocal-rank fusion across the two legs.
  const scores = new Map<string, { row: HybridBill; score: number }>();
  const addLeg = (rows: (BillRow | HybridBill)[], sims?: (number | null)[]) => {
    rows.forEach((row, i) => {
      const key = `${row.congress}-${row.bill_type}-${row.number}`;
      const score = 1 / (RRF_K + i + 1);
      const existing = scores.get(key);
      const sim = sims?.[i] ?? existing?.row.similarity ?? null;
      if (existing) {
        existing.score += score;
        if (sim != null && existing.row.similarity == null) existing.row.similarity = sim;
      } else {
        scores.set(key, {
          row: { ...row, similarity: sim, source: (row as HybridBill).source ?? null },
          score,
        });
      }
    });
  };
  addLeg(semantic, semantic.map((r) => r.similarity));
  addLeg(keyword);

  const pinned = new Set(refs.map((r) => `${r.type}-${r.number}`));
  const blended = [...scores.values()].map((e) => {
    const t = e.row.bill_type.toLowerCase() === "hr" ? "hr" : e.row.bill_type.toLowerCase();
    const isRef = pinned.has(`${t}-${e.row.number}`);
    return { ...e.row, _score: e.score + (isRef ? BILL_REF_SCORE : 0) };
  });
  blended.sort((a, b) => b._score - a._score);
  return blended
    .slice(0, limit)
    .map(({ _score, ...row }) => {
      void _score;
      return row;
    });
}
