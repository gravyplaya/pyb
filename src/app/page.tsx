import Image from "next/image";
import { billsSince, trendingBills, type BillRow } from "@/lib/bills";
import BillLists from "@/components/BillLists";
import ChatBox from "@/components/ChatBox";

export const dynamic = "force-dynamic";

/**
 * Homepage modeled on the live puckyobills.com: the two bill lists up top,
 * the chatbox in the middle, and the mascot logo as the page background.
 * Clicking a bill opens a summary modal — the external congress.gov link
 * lives inside the modal, not on the lists. Replaces the old getDailyUpdates
 * / getMostViewedThisWeek n8n webhooks; reads only from Postgres.
 */

type Load =
  | { state: "ready"; latest: BillRow[]; trending: BillRow[] }
  | { state: "db-down" }
  | { state: "empty" };

async function loadHome(): Promise<Load> {
  const [latest, trending] = await Promise.all([
    billsSince(undefined, 12).catch(() => null),
    trendingBills(8).catch(() => null),
  ]);
  if (latest === null || trending === null) return { state: "db-down" };
  if (latest.length === 0 && trending.length === 0) return { state: "empty" };
  return { state: "ready", latest, trending };
}

function SetupPanel({ synced }: { synced: boolean }) {
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-amber-300 bg-amber-50/95 p-6 text-slate-800 backdrop-blur">
      <h2 className="text-lg font-bold">
        {synced ? "Waiting for the first sync" : "Database not connected"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed">
        {synced ? (
          <>
            The database is reachable but empty. The poller fills it every 15
            minutes while the server runs with <code>PYB_SYNC=1</code> (default
            in Docker). You can also trigger one now:{" "}
            <code>POST /api/sync</code> with your <code>PYB_SYNC_TOKEN</code>.
          </>
        ) : (
          <>
            This page reads from Postgres. Check that <code>DATABASE_URL</code>{" "}
            points at a running database (migrations apply automatically at
            boot) and that a first sync has run.
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
    <div className="relative flex min-h-screen flex-col">
      {/* Mascot logo as the page background, faded behind everything */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "url('/images/bill.png')",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center 30%",
          backgroundSize: "min(60vmin, 420px)",
          opacity: 0.08,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-slate-50/60 via-slate-50/80 to-slate-50"
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <Image
              src="/images/bill.png"
              alt="Puck Yo Bills mascot"
              width={40}
              height={63}
              className="h-10 w-auto"
              priority
            />
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
                Puck Yo Bills
              </h1>
              <p className="text-xs text-slate-500">
                Your guide to understanding congressional bills and legislation.
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-10 px-4 py-8">
          <section className="text-center">
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Understanding congressional bills, made easy
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">
              From climate change to education reform, we help you track and
              understand the laws that shape your future — synced from the
              official Congress.gov API.
            </p>
          </section>

          {data.state !== "ready" ? (
            <SetupPanel synced={data.state === "empty"} />
          ) : (
            <>
              <BillLists latest={data.latest} trending={data.trending} />

              {/* Chatbox sits between the lists and the footer, like the live site */}
              <ChatBox />
            </>
          )}
        </main>

        <footer className="border-t border-slate-200/80 bg-white/80 py-5 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-1 px-4 text-xs text-slate-500">
            <p>© {new Date().getFullYear()} Puck Yo Bills. All rights reserved.</p>
            <p>
              Bill data from the official{" "}
              <a
                href="https://www.congress.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-blue-800"
              >
                Congress.gov
              </a>{" "}
              API (Library of Congress). Not affiliated with Congress.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
