import { NextResponse } from "next/server";
import { billDetail } from "@/lib/bills";

/**
 * GET /api/bills/{congress}/{type}/{number}
 * The "important parts" a visitor looks for, assembled from the DB row plus
 * the lazily-fetched-and-cached Congress.gov detail JSON and summary.
 */

export const dynamic = "force-dynamic";

const BILL_PATHS: Record<string, string> = {
  hr: "house-bill",
  s: "senate-bill",
  hjres: "house-joint-resolution",
  sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
  hres: "house-resolution",
  sres: "senate-resolution",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ congress: string; type: string; number: string }> },
) {
  const { congress, type, number } = await params;
  const c = Number(congress);
  if (!Number.isInteger(c) || !type || !number) {
    return NextResponse.json({ error: "Invalid bill identifier" }, { status: 400 });
  }

  try {
    const d = await billDetail(c, type, number);
    if (!d) {
      return NextResponse.json({ error: "Bill not found in the local index" }, { status: 404 });
    }

    const detail = (d.detail ?? {}) as Record<string, unknown>;
    // Congress.gov v3 detail JSON uses `sponsors` (array); older data used
    // `sponsor` (object). Handle both.
    const rawSponsors = detail.sponsors;
    const rawSponsor = Array.isArray(rawSponsors)
      ? ((rawSponsors[0] ?? null) as Record<string, unknown> | null)
      : ((rawSponsors ?? detail.sponsor ?? null) as Record<string, unknown> | null);
    const latestAction = (detail.latestAction ?? null) as Record<string, unknown> | null;
    const path = BILL_PATHS[d.bill_type.toLowerCase()] ?? d.bill_type.toLowerCase();

    return NextResponse.json({
      id: { congress: d.congress, type: d.bill_type, number: d.number },
      title: d.title,
      chamber: d.origin_chamber,
      introducedDate: d.introduced_date,
      updateDate: d.update_date,
      sponsor: rawSponsor
        ? {
            name:
              rawSponsor.fullName ??
              [rawSponsor.firstName, rawSponsor.lastName].filter(Boolean).join(" ") ??
              null,
            party: rawSponsor.party ?? null,
            state: rawSponsor.state ?? null,
          }
        : null,
      latestAction: latestAction
        ? { date: latestAction.actionDate ?? null, text: latestAction.text ?? null }
        : d.latest_action_date
          ? { date: d.latest_action_date, text: d.latest_action_text }
          : null,
      actionsCount: (detail.actions as Record<string, unknown> | undefined)?.count ?? null,
      summaryText: d.summary_text,
      congressGovUrl: `https://www.congress.gov/bill/${d.congress}th-congress/${path}/${d.number}`,
    });
  } catch (e) {
    console.error("[pyb] bill detail route failed:", e);
    return NextResponse.json({ error: "Failed to load bill details" }, { status: 500 });
  }
}
