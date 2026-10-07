/**
 * Delta-sync poller: Congress.gov → Postgres.
 *
 * Strategy: pull the list endpoint sorted by updateDate desc, walking pages
 * until we see bills older than our last successful sync window. Every row
 * lands in `bills` via upsert. Detail JSON is fetched lazily (Phase 2+),
 * keeping Phase 1 cheap: one page of 250 usually covers a day of updates.
 *
 * Frequency: 15 minutes. Runs in-process via instrumentation.ts. In
 * development it starts disabled unless PYB_SYNC=1 — you don't want every
 * `npm run dev` hammering the API.
 */

import { congress } from "@/lib/congress/client";
import { tx } from "@/lib/db";
import type { BillListItem } from "@/lib/congress/types";

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const MAX_PAGES = 40;
const SAFETY_MS = 5 * 60 * 1000; // window overlap so boundary updates aren't missed

export interface SyncResult {
  pages: number;
  billsUpserted: number;
  windowStart: string;
  windowEnd: string;
  skipped?: boolean;
}

let running = false;

export async function syncOnce(): Promise<SyncResult> {
  if (running) return { pages: 0, billsUpserted: 0, windowStart: "", windowEnd: "", skipped: true };
  running = true;
  try {
    const windowEnd = new Date();
    const priorEnd = await loadSyncState();
    // Overlap the previous window by 5 minutes: Congress.gov update timestamps
    // can shift late; a small re-read is cheaper than a missed bill.
    // Cold start (no prior window): backfill the last 7 days so the DB has
    // a real baseline, not an empty hour.
    const from = priorEnd
      ? new Date(priorEnd.getTime() - SAFETY_MS)
      : new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    let billsUpserted = 0;
    let pages = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await congress.bills({
        fromDateTime: from ? from.toISOString().replace(/\.\d+Z$/, "Z") : undefined,
        limit: 250,
        offset: page * 250,
      });
      pages++;
      if (!res.bills?.length) break;

      const stop = await upsertBills(res.bills);
      billsUpserted += stop;

      // Stop when the oldest item on this page predates the window start.
      if (from && res.bills.length < 250) break;
      if (!res.pagination?.next) break;
    }

    await saveSyncState(windowEnd, "ok", null, billsUpserted);
    return { pages, billsUpserted, windowStart: from?.toISOString() ?? "full", windowEnd: windowEnd.toISOString() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      // Error path: record status but DO NOT advance last_window_end —
      // the next sync must re-cover the failed window, not skip it.
      await saveSyncState(null, "error", msg, 0);
    } catch {}
    throw e;
  } finally {
    running = false;
  }
}

async function upsertBills(items: BillListItem[]): Promise<number> {
  if (!items.length) return 0;
  await tx(async (client) => {
    for (const b of items) {
      await client.query(
        `INSERT INTO bills (congress, bill_type, number, title, origin_chamber, origin_chamber_code,
                            introduced_date, latest_action_date, latest_action_text,
                            update_date, update_date_including_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (congress, bill_type, number) DO UPDATE SET
           title = EXCLUDED.title,
           origin_chamber = EXCLUDED.origin_chamber,
           origin_chamber_code = EXCLUDED.origin_chamber_code,
           introduced_date = EXCLUDED.introduced_date,
           latest_action_date = EXCLUDED.latest_action_date,
           latest_action_text = EXCLUDED.latest_action_text,
           update_date = EXCLUDED.update_date,
           update_date_including_text = EXCLUDED.update_date_including_text`,
        [
          b.congress,
          b.type,
          b.number,
          b.title,
          b.originChamber,
          b.originChamberCode,
          b.introducedDate,
          b.latestAction?.actionDate ?? null,
          b.latestAction?.text ?? null,
          b.updateDate,
          b.updateDateIncludingText ?? b.updateDate,
        ],
      );
    }
  });
  return items.length;
}

async function loadSyncState(): Promise<Date | null> {
  const { query } = await import("@/lib/db");
  const res = await query<{ last_window_end: string | null }>(
    "SELECT last_window_end FROM sync_state WHERE id = 1",
  );
  const v = res.rows[0]?.last_window_end;
  return v ? new Date(v) : null;
}

async function saveSyncState(windowEnd: Date | null, status: string, error: string | null, upserted: number): Promise<void> {
  const { query } = await import("@/lib/db");
  await query(
    `UPDATE sync_state SET
       last_window_end = COALESCE($1, last_window_end),
       last_sync_at = now(),
       last_status = $2,
       last_error = $3,
       bills_upserted = $4
     WHERE id = 1`,
    [windowEnd, status, error, upserted],
  );
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Starts the 15-minute sync loop. Call once at server boot. */
export function startSync(): void {
  if (timer) return;
  const tick = async () => {
    try {
      const r = await syncOnce();
      console.log(`[pyb-sync] ${new Date().toISOString()} pages=${r.pages} bills=${r.billsUpserted}`);
    } catch (e) {
      console.error("[pyb-sync] sync failed:", e);
    }
    timer = setTimeout(tick, POLL_INTERVAL_MS);
  };
  timer = setTimeout(tick, 3000); // first sync 3s after boot
  console.log("[pyb-sync] poller started (15 min interval)");
}
