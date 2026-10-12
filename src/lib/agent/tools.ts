/**
 * Agent tools — the live-data layer behind the chat. Backed by the local
 * Postgres index (synced every 15 min from Congress.gov) plus the lazy
 * detail/summary fetch in bills.ts, so answers come from real data.
 */

import { billDetail, billsSince, hybridSearchBills, recentActions, type BillRow } from "@/lib/bills";
import { congress as congressApi } from "@/lib/congress/client";
import type { ToolDef } from "./openrouter";

const VALID_TYPES = new Set(["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"]);

function billLabel(r: BillRow): string {
  const t = r.bill_type.toUpperCase() === "HR" ? "H.R." : r.bill_type.toUpperCase();
  return `${t} ${r.number} (${r.congress}th)`;
}

function compactBill(r: BillRow) {
  return {
    bill: billLabel(r),
    title: r.title,
    origin_chamber: r.origin_chamber,
    introduced: r.introduced_date,
    latest_action: r.latest_action_text
      ? `${r.latest_action_date ?? ""} ${r.latest_action_text}`.trim()
      : null,
  };
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/** Clamp a model-supplied "limit" argument into [min, max], else default. */
function clampInt(value: unknown, min: number, max: number, dflt: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : dflt;
}

export async function toolSearchBills(args: { query?: string; limit?: number }): Promise<string> {
  const q = (args.query ?? "").trim();
  if (!q) return JSON.stringify({ error: "query is required" });
  // Hybrid search: semantic over the pgvector embeddings blended with the
  // keyword index; falls back to keyword-only when the vector store is
  // empty or the embedding API is down.
  const rows = await hybridSearchBills(q, clampInt(args.limit, 1, 20, 8));
  const results = rows.map((r) => ({
    ...compactBill(r),
    similarity: r.similarity == null ? null : Number(r.similarity.toFixed(3)),
    from: r.source ?? "keyword",
  }));
  return JSON.stringify({ count: results.length, bills: results });
}

export async function toolBillDetail(args: {
  congress?: number;
  type?: string;
  number?: number | string;
}): Promise<string> {
  const congress = Number(args.congress);
  const type = String(args.type ?? "").toLowerCase();
  const number = String(args.number ?? "").replace(/\D/g, "");
  if (!Number.isInteger(congress) || congress < 1 || !VALID_TYPES.has(type) || !number) {
    return JSON.stringify({
      error: "need congress (int), type (hr|s|hjres|sjres|hconres|sconres|hres|sres) and number",
    });
  }
  // Local index first (lazy detail + summary cache), live Congress.gov API
  // as the fallback — the index is a rolling sync window, so most named
  // bills aren't in it.
  const d = (await billDetail(congress, type, number).catch(() => null)) ?? (await liveBill(congress, type, number));
  if (!d) return JSON.stringify({ error: `bill not found: ${type.toUpperCase()} ${number}, ${congress}th Congress` });

  const detail = (d.detail ?? {}) as Record<string, unknown>;
  const rawSponsors = Array.isArray(detail.sponsors)
    ? (detail.sponsors[0] ?? null) as Record<string, unknown> | null
    : (detail.sponsor ?? null) as Record<string, unknown> | null;

  // Truncate the raw summary — enough for the model, not a token bomb.
  const summary = (d.summary_text ?? "").slice(0, 4000);

  return JSON.stringify({
    bill: billLabel(d),
    title: d.title,
    origin_chamber: d.origin_chamber,
    introduced: d.introduced_date,
    sponsor: rawSponsors
      ? {
          name: rawSponsors.fullName ?? null,
          party: rawSponsors.party ?? null,
          state: rawSponsors.state ?? null,
        }
      : null,
    latest_action: detail.latestAction ?? d.latest_action_text,
    policy_area: (detail.policyArea as Record<string, unknown> | undefined)?.name ?? null,
    actions_count: (detail.actions as Record<string, unknown> | undefined)?.count ?? null,
    law: detail.laws ?? null,
    plain_language_summary: summary || "(no plain-language summary available for this bill yet)",
  });
}

export async function toolBillSummary(args: {
  congress?: number;
  type?: string;
  number?: number | string;
}): Promise<string> {
  const congress = Number(args.congress);
  const type = String(args.type ?? "").toLowerCase();
  const number = String(args.number ?? "").replace(/\D/g, "");
  if (!Number.isInteger(congress) || !VALID_TYPES.has(type) || !number) {
    return JSON.stringify({ error: "need congress, type and number" });
  }
  const d =
    (await billDetail(congress, type, number).catch(() => null)) ??
    (await liveBill(congress, type, number));
  if (!d) return JSON.stringify({ error: `bill not found: ${type.toUpperCase()} ${number}, ${congress}th Congress` });
  return JSON.stringify({
    bill: billLabel(d),
    title: d.title,
    plain_language_summary: d.summary_text?.slice(0, 4000) || "(no plain-language summary available yet)",
  });
}

/**
 * Live Congress.gov fetch for bills outside the local index. Returns the same
 * minimal shape the DB-backed path produces.
 */
async function liveBill(congress: number, type: string, number: string) {
  try {
    const [detail, summaries] = await Promise.all([
      congressApi.billDetail(congress, type, number),
      congressApi.billSummaries(congress, type, number).catch(() => null),
    ]);
    const b = detail?.bill;
    if (!b) return null;
    return {
      congress: b.congress,
      bill_type: type,
      number: String(number),
      title: b.title ?? "(untitled)",
      origin_chamber: b.originChamber ?? "",
      introduced_date: b.introducedDate ?? "",
      latest_action_date: b.latestAction?.actionDate ?? null,
      latest_action_text: b.latestAction?.text ?? null,
      update_date: b.updateDate ?? "",
      detail: b as Record<string, unknown>,
      summary_text: summaries?.summaries?.[0]?.text ?? null,
    };
  } catch (e) {
    console.error(`[pyb-agent] live congress fetch failed for ${type} ${number}:`, e);
    return null;
  }
}

export async function toolLatestActions(args: {
  chamber?: string;
  days?: number;
  limit?: number;
}): Promise<string> {
  const chamberRaw = (args.chamber ?? "").toLowerCase();
  const chamber =
    chamberRaw === "house" || chamberRaw === "senate"
      ? chamberRaw.charAt(0).toUpperCase() + chamberRaw.slice(1)
      : null;
  const days = clampInt(args.days, 1, 30, 3);
  const limit = clampInt(args.limit, 1, 25, 12);

  let rows = await recentActions({ chamber, days, limit });
  // Quiet stretch (weekends/recess): fall back to most recent actions overall.
  if (rows.length === 0) {
    rows = await recentActions({ chamber, days: 60, limit });
  }
  if (rows.length === 0) {
    rows = await billsSince(undefined, limit);
  }
  return JSON.stringify({
    window_days: days,
    chamber: chamber ?? "both",
    count: rows.length,
    bills: rows.map(compactBill),
  });
}

// ---------------------------------------------------------------------------
// Tool schemas (OpenAI function-calling format) + dispatch
// ---------------------------------------------------------------------------

export const AGENT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_bills",
      description:
        "Hybrid search over the bill index — semantic meaning plus title keywords, so topical questions find relevant bills even when no word matches a title. Use for 'bills about housing affordability', 'climate bills', 'what's in the bills on veterans'. Returns bill numbers, titles, latest actions, and a similarity score per bill.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords to match in bill titles" },
          limit: { type: "integer", description: "Max results (default 8, max 20)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bill_detail",
      description:
        "Full detail for one bill: sponsor, latest action, policy area, action count, and the plain-language summary. Use whenever the user names a specific bill (e.g. 'explain H.R. 1').",
      parameters: {
        type: "object",
        properties: {
          congress: { type: "integer", description: "Congress number, e.g. 119" },
          type: {
            type: "string",
            enum: ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"],
            description: "Bill type: hr=House bill, s=Senate bill, hjres/sjres=joint resolutions, etc.",
          },
          number: { type: "string", description: "Bill number, e.g. '1'" },
        },
        required: ["congress", "type", "number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bill_summary",
      description:
        "Just the plain-language summary for one bill (shorter than full detail). Use when the user asks what a bill is about.",
      parameters: {
        type: "object",
        properties: {
          congress: { type: "integer", description: "Congress number, e.g. 119" },
          type: {
            type: "string",
            enum: ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"],
          },
          number: { type: "string", description: "Bill number, e.g. '1'" },
        },
        required: ["congress", "type", "number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_latest_actions",
      description:
        "Most recent bill actions in Congress, newest first. Use for 'what happened today/this week in Congress / the Senate / the House'.",
      parameters: {
        type: "object",
        properties: {
          chamber: { type: "string", enum: ["house", "senate"], description: "Filter by originating chamber" },
          days: { type: "integer", description: "Look-back window in days (default 3, max 30)" },
          limit: { type: "integer", description: "Max bills returned (default 12, max 25)" },
        },
      },
    },
  },
];

const EXECUTORS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  search_bills: (a) => toolSearchBills(a as never),
  get_bill_detail: (a) => toolBillDetail(a as never),
  get_bill_summary: (a) => toolBillSummary(a as never),
  get_latest_actions: (a) => toolLatestActions(a as never),
};

export async function executeTool(name: string, rawArgs: string): Promise<string> {
  const fn = EXECUTORS[name];
  if (!fn) return JSON.stringify({ error: `unknown tool: ${name}` });
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ error: `tool arguments were not valid JSON: ${rawArgs.slice(0, 200)}` });
  }
  try {
    return await fn(args);
  } catch (e) {
    console.error(`[pyb-agent] tool ${name} failed:`, e);
    return JSON.stringify({
      error: `tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
