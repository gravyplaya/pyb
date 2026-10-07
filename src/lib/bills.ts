/**
 * Read-side bill queries. All pages read from the DB; detail JSON and
 * plain-language summaries are fetched lazily from Congress.gov and cached
 * in `bills` so the API is hit once per bill, not once per page view.
 */

import { query } from "@/lib/db";
import { congress as congressApi } from "@/lib/congress/client";

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

function mapRow(r: Record<string, unknown>): BillRow {
  return {
    congress: Number(r.congress),
    bill_type: String(r.bill_type),
    number: String(r.number),
    title: String(r.title),
    origin_chamber: String(r.origin_chamber),
    introduced_date: String(r.introduced_date).slice(0, 10),
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
