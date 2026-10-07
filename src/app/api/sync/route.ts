import { NextResponse } from "next/server";
import { syncOnce } from "@/lib/congress/poller";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manual sync trigger — POST only. Bearer token via PYB_SYNC_TOKEN when set. */
export async function POST(req: Request) {
  const token = process.env.PYB_SYNC_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const r = await syncOnce();
    if (r.skipped) return NextResponse.json({ skipped: true, reason: "sync already running" });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
