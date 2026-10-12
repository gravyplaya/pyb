/**
 * Chat session retention: chat_sessions grows forever on a public,
 * unauthenticated endpoint, so stale conversations are pruned on a timer.
 * chat_messages rows go with their session (ON DELETE CASCADE).
 */

import { query } from "@/lib/db";

const INTERVAL_MS = 6 * 60 * 60 * 1000; // sweep every 6 hours
const RETENTION_DAYS = 30;

let timer: ReturnType<typeof setTimeout> | null = null;

export async function cleanupOnce(): Promise<number> {
  const res = await query(
    `DELETE FROM chat_sessions WHERE last_active_at < now() - make_interval(days => $1)`,
    [RETENTION_DAYS],
  );
  return res.rowCount ?? 0;
}

/** Starts the retention sweep. Call once at server boot. */
export function startChatCleanup(): void {
  if (timer) return;
  const tick = async () => {
    try {
      const removed = await cleanupOnce();
      if (removed > 0) console.log(`[pyb-chat] retention: removed ${removed} stale session(s)`);
    } catch (e) {
      console.error("[pyb-chat] retention cleanup failed:", e);
    }
    timer = setTimeout(tick, INTERVAL_MS);
  };
  timer = setTimeout(tick, 60_000); // first sweep 1 min after boot
  console.log("[pyb-chat] session retention started (30-day window, 6h interval)");
}
