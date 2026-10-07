/**
 * Types for the Congress.gov API v3, verified against live responses.
 * Only what Phase 1 stores: list-level bill rows + raw detail JSON.
 */

export interface LatestAction {
  actionDate: string; // "2025-07-04"
  text: string; // "Became Public Law No: 119-21."
}

/** Item in `GET /bill` and `GET /bill/{congress}` list responses. */
export interface BillListItem {
  congress: number;
  type: string; // "HR", "S", "HCONRES", ...
  number: string;
  title: string;
  originChamber: string; // "House" | "Senate"
  originChamberCode: string; // "H" | "S"
  introducedDate: string; // "2007-01-04"
  latestAction: LatestAction;
  updateDate: string; // "2024-02-07"
  updateDateIncludingText?: string;
  url: string; // detail endpoint URL
}

export interface Pagination {
  count: number;
  next?: string;
}

export interface BillListResponse {
  bills: BillListItem[];
  pagination: Pagination;
}

/** `GET /bill/{congress}/{billType}/{billNumber}` — stored raw as jsonb. */
export interface BillDetailResponse {
  bill: {
    congress: number;
    type: string;
    number: string;
    title: string;
    introducedDate: string;
    updateDate: string;
    updateDateIncludingText?: string;
    originChamber: string;
    originChamberCode: string;
    latestAction?: LatestAction;
    sponsors?: Array<{
      fullName?: string;
      bioguideId?: string;
      party?: string;
      state?: string;
      district?: number;
    }>;
    cosponsors?: { count?: number } | null;
    policyArea?: { name?: string } | null;
    committees?: { count?: number } | null;
    laws?: Array<{ number?: string; type?: string }>;
    actions?: { count?: number };
    amendments?: { count?: number };
    textVersions?: { count?: number };
    summaries?: { count?: number };
    titles?: { count?: number };
    subjects?: { count?: number };
    relatedBills?: { count?: number };
    legislationUrl?: string;
    [key: string]: unknown;
  };
}

export interface SummaryItem {
  versionCode?: string;
  updateDate?: string;
  text?: string;
  description?: string;
  name?: string;
  actionDesc?: string;
}

export interface BillSummariesResponse {
  summaries: SummaryItem[];
  pagination: Pagination;
}
