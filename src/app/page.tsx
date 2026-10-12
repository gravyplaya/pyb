import { billsSince, trendingBills, type BillRow } from "@/lib/bills";

export const dynamic = "force-dynamic";

/**
 * Homepage = the data surface that replaces the old getDailyUpdates /
 * getMostViewedThisWeek n8n webhooks. Reads only from Postgres; when the DB
 * is unreachable or not yet synced we show setup guidance instead of an error.
 */

type Load =
  | { state: "ready"; latest: BillRow[]; trending: BillRow[] }
  | { state: "db-down" }
  | { state: "empty" };

async function loadHome(): Promise<Load> {
  const [latest, trending] = await Promise.all([
    billsSince(undefined, 12).catch(() => null),
    trendingBills(6).catch(() => null),
  ]);
  if (latest === null || trending === null) return { state: "db-down" };
  if (latest.length === 0 && trending.length === 0) return { state: "empty" };
  return { state: "ready", latest, trending };
}

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

function normType(type: string): string {
  return type.toLowerCase();
}

function billLabel(rawType: string, number: string): string {
  switch (normType(rawType)) {
    case "hr":
      return `H.R. ${number}`;
    case "s":
      return `S. ${number}`;
    case "hjres":
      return `H.J.Res. ${number}`;
    case "sjres":
      return `S.J.Res. ${number}`;
    case "hconres":
      return `H.Con.Res. ${number}`;
    case "sconres":
      return `S.Con.Res. ${number}`;
    case "hres":
      return `H.Res. ${number}`;
    case "sres":
      return `S.Res. ${number}`;
    default:
      return `${rawType.toUpperCase()} ${number}`;
  }
}

function congressGovUrl(b: BillRow): string {
  const path = BILL_PATHS[normType(b.bill_type)] ?? b.bill_type.toLowerCase();
  return `https://www.congress.gov/bill/${b.congress}th-congress/${path}/${b.number}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function BillCard({ bill }: { bill: BillRow }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rounded bg-blue-900 px-2 py-0.5 text-xs font-bold text-white">
          {billLabel(bill.bill_type, bill.number)} · {bill.congress}
        </span>
        <span className="text-xs text-slate-500">
          {bill.origin_chamber} · introduced {fmtDate(bill.introduced_date)}
        </span>
      </div>
      <a
        href={congressGovUrl(bill)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 block font-medium text-slate-900 hover:text-blue-800"
      >
        {bill.title}
      </a>
      {bill.latest_action_text && (
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-semibold">Latest action</span> (
          {fmtDate(bill.latest_action_date)}): {bill.latest_action_text}
        </p>
      )}
    </li>
  );
}

function SetupPanel({ synced }: { synced: boolean }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-slate-800">
      <h2 className="text-lg font-bold">
        {synced ? "Waiting for the first sync" : "Database not connected"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed">
        {synced ? (
          <>
            The database is reachable but empty. The poller fills it every 15
            minutes when the server runs with <code>PYB_SYNC=1</code> (default
            in Docker). You can also trigger one now:{" "}
            <code>POST /api/sync</code> with your <code>PYB_SYNC_TOKEN</code>.
          </>
        ) : (
          <>
            This page reads from Postgres. Check that <code>DATABASE_URL</code>{" "}
            points at a running database (the app applies its schema migrations
            automatically at boot) and that a first sync has run.
          </>
        )}
      </p>
      <p className="mt-2 text-sm">
        Health check: <code>/api/health</code> shows DB status and last sync
        time.
      </p>
    </div>
  );
}

export default async function Home() {
  const data = await loadHome();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
              PuckYo<span className="text-blue-800">Bills</span>
            </h1>
            <p className="text-xs text-slate-500">
              What Congress is actually doing, in plain language
            </p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#latest" className="text-slate-600 hover:text-blue-800">
              Latest
            </a>
            <a href="#trending" className="text-slate-600 hover:text-blue-800">
              Trending
            </a>
            <span
              className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-400"
              title="Chat agent lands in Phase 3"
            >
              Chat — soon
            </span>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <section className="mb-10">
          <h2 className="text-3xl font-bold text-slate-900">
            Every bill, made simple.
          </h2>
          <p className="mt-2 max-w-2xl text-slate-600">
            PuckYoBills follows new bills and activity in the U.S. House and
            Senate — synced straight from the official Congress.gov API — and
            soon you&apos;ll be able to ask an AI agent what any of it means.
          </p>
        </section>

        {data.state !== "ready" ? (
          <SetupPanel synced={data.state === "empty"} />
        ) : (
          <>
            <section id="latest" className="mb-10">
              <h2 className="mb-4 text-xl font-bold text-slate-900">
                Latest activity
              </h2>
              <ul className="space-y-3">
                {data.latest.map((b) => (
                  <BillCard
                    key={`${b.congress}-${b.bill_type}-${b.number}`}
                    bill={b}
                  />
                ))}
              </ul>
            </section>

            {data.trending.length > 0 && (
              <section id="trending">
                <h2 className="mb-4 text-xl font-bold text-slate-900">
                  Trending this month
                </h2>
                <ul className="space-y-3">
                  {data.trending.map((b) => (
                    <BillCard
                      key={`${b.congress}-${b.bill_type}-${b.number}`}
                      bill={b}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto max-w-5xl px-4 text-xs text-slate-500">
          Data from the official{" "}
          <a
            href="https://www.congress.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-blue-800"
          >
            Congress.gov
          </a>{" "}
          API (Library of Congress). Not affiliated with Congress. ©{" "}
          {new Date().getFullYear()} PuckYoBills.
        </div>
      </footer>
    </div>
  );
}
