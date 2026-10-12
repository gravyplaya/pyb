"use client";

import { useCallback, useEffect, useState } from "react";
import type { BillRow } from "@/lib/bills";

/**
 * The two homepage lists ("Daily Bill Updates" / "Most Viewed Bills This Week")
 * plus the summary modal. Clicking a bill opens the modal — the external
 * congress.gov link lives inside the modal, nowhere else.
 */

interface Detail {
  id: { congress: number; type: string; number: string };
  title: string;
  chamber: string;
  introducedDate: string;
  updateDate?: string;
  sponsor: { name: string | null; party: string | null; state: string | null } | null;
  latestAction: { date: string | null; text: string | null } | null;
  actionsCount: number | null;
  summaryText: string | null;
  congressGovUrl: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

function ListSection({
  title,
  bills,
  onOpen,
}: {
  title: string;
  bills: BillRow[];
  onOpen: (b: BillRow) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur">
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">
        {title}
      </h2>
      <ul className="divide-y divide-slate-100">
        {bills.map((b) => (
          <li key={`${b.congress}-${b.bill_type}-${b.number}`}>
            <button
              onClick={() => onOpen(b)}
              className="w-full px-4 py-3 text-left transition hover:bg-amber-50"
            >
              <span className="rounded bg-blue-900 px-1.5 py-0.5 text-[11px] font-bold text-white">
                {b.bill_type} {b.number}
              </span>
              <span className="ml-2 text-[11px] text-slate-400">
                {fmtDate(b.latest_action_date ?? b.update_date)}
              </span>
              <p className="mt-1 line-clamp-2 text-sm text-slate-700">{b.title}</p>
            </button>
          </li>
        ))}
        {bills.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-400">Nothing here yet.</li>
        )}
      </ul>
    </section>
  );
}

function Modal({
  bill,
  onClose,
}: {
  bill: BillRow;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    fetch(
      `/api/bills/${bill.congress}/${bill.bill_type}/${bill.number}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Detail) => alive && setDetail(d))
      .catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [bill]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <span className="rounded bg-blue-900 px-2 py-0.5 text-xs font-bold text-white">
              {bill.bill_type} {bill.number} · {bill.congress}th Congress
            </span>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {detail?.title ?? bill.title}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-2xl leading-none text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-red-700">
              Couldn&apos;t load details ({error}).
            </p>
          )}

          {!detail && !error && (
            <p className="animate-pulse text-slate-400">
              Loading the plain-language summary… (first view of a bill fetches
              it from Congress.gov, then it&apos;s cached)
            </p>
          )}

          {detail && (
            <>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Sponsor
                  </dt>
                  <dd className="text-slate-800">
                    {detail.sponsor?.name ?? "—"}
                    {detail.sponsor?.party || detail.sponsor?.state
                      ? ` (${[detail.sponsor?.party, detail.sponsor?.state].filter(Boolean).join("-")})`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Introduced
                  </dt>
                  <dd className="text-slate-800">{fmtDate(detail.introducedDate)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Latest action
                  </dt>
                  <dd className="text-slate-800">
                    {detail.latestAction?.text ?? "—"}
                    {detail.latestAction?.date && (
                      <span className="ml-1 text-slate-400">
                        ({fmtDate(detail.latestAction.date)})
                      </span>
                    )}
                  </dd>
                </div>
                {detail.actionsCount != null && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Actions so far
                    </dt>
                    <dd className="text-slate-800">{detail.actionsCount}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Chamber
                  </dt>
                  <dd className="text-slate-800">{detail.chamber}</dd>
                </div>
              </dl>

              {detail.summaryText && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Summary (from Congress.gov)
                  </h3>
                  <p className="max-h-64 overflow-y-auto whitespace-pre-line rounded bg-slate-50 p-3 leading-relaxed text-slate-700">
                    {detail.summaryText}
                  </p>
                </div>
              )}

              <a
                href={detail.congressGovUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-md bg-blue-900 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
              >
                Read the full bill on congress.gov →
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BillLists({
  latest,
  trending,
}: {
  latest: BillRow[];
  trending: BillRow[];
}) {
  const [selected, setSelected] = useState<BillRow | null>(null);
  const close = useCallback(() => setSelected(null), []);

  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ListSection title="Daily Bill Updates" bills={latest} onOpen={setSelected} />
        <ListSection
          title="Most Viewed Bills This Week"
          bills={trending}
          onOpen={setSelected}
        />
      </div>
      {selected && <Modal bill={selected} onClose={close} />}
    </>
  );
}
