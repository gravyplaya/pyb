import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + sync status: used by the Docker healthcheck and by humans. */
export async function GET() {
  try {
    const db = await query<{ count: string }>("SELECT count(*) AS count FROM bills");
    const sync = await query<{
      last_sync_at: string | null;
      last_status: string | null;
      last_error: string | null;
      bills_upserted: string | null;
    }>("SELECT last_sync_at, last_status, last_error, bills_upserted FROM sync_state WHERE id = 1");

    return NextResponse.json({
      ok: true,
      db: { bills: Number(db.rows[0]?.count ?? 0) },
      sync: sync.rows[0] ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
