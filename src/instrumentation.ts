/**
 * Next.js instrumentation hook — runs once at server boot (nodejs runtime).
 * Applies DB migrations, then starts the Congress.gov sync poller.
 *
 * In dev, the poller stays off unless PYB_SYNC=1 (the front page shouldn't
 * hammer Congress.gov on every hot reload).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("@/lib/db/migrations");
  try {
    const ran = await runMigrations();
    if (ran.length) console.log(`[pyb] migrations applied: ${ran.join(", ")}`);
  } catch (e) {
    // Server still boots: pages can render from cache-less reads; sync/health
    // endpoints will surface the failure.
    console.error("[pyb] migrations failed:", e);
  }

  if (process.env.PYB_SYNC === "1") {
    const { startSync } = await import("@/lib/congress/poller");
    startSync();
  } else {
    console.log("[pyb-sync] poller disabled (set PYB_SYNC=1 to enable)");
  }
}
