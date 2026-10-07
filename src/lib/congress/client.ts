/**
 * Congress.gov API v3 client with rate-limit hygiene.
 *
 * - One class instance per process (exported as `congress`).
 * - Token-bucket limiter: 5,000 req/hour cap → conservative 20 req/s burst,
 *   sustained 1.2 req/s (4,320/hour), leaving budget for detail fetches.
 * - In-memory TTL cache for read paths (default 15 min).
 * - API key from CONGRESS_API_KEY, only ever in env — never committed.
 */

const BASE = "https://api.congress.gov/v3";
const CACHE_TTL_MS = 15 * 60 * 1000;

export class RateLimitError extends Error {}
export class CongressApiError extends Error {}

/** Token-bucket: burst up to `burst`, refills at `refillPerSec`. */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private readonly burst: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = burst;
    this.lastRefill = Date.now();
  }
  async take(): Promise<void> {
    for (let i = 0; i < 300; i++) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new RateLimitError("congress client: waited 30s for a rate-limit token");
  }
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.refillPerSec);
      this.lastRefill = now;
    }
  }
}

interface CacheEntry {
  expires: number;
  value: unknown;
}

export class CongressClient {
  private limiter = new TokenBucket(20, 1.2);
  private cache = new Map<string, CacheEntry>();

  private key(): string {
    const k = process.env.CONGRESS_API_KEY;
    if (!k) throw new CongressApiError("CONGRESS_API_KEY is not set");
    return k;
  }

  private cacheGet<T>(ck: string): T | undefined {
    const hit = this.cache.get(ck);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    if (hit) this.cache.delete(ck);
    return undefined;
  }

  private async get<T>(path: string, params: Record<string, string> = {}, useCache = true): Promise<T> {
    // NOTE: `new URL(path, BASE)` would drop the `/v3` segment (absolute
    // paths replace the base path), so we concatenate manually.
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const ck = url.toString();

    if (useCache) {
      const cached = this.cacheGet<T>(ck);
      if (cached !== undefined) return cached;
    }

    await this.limiter.take();
    const res = await fetch(`${url.toString()}&api_key=${this.key()}`, {
      // Congress.gov data changes at most every few minutes at the top;
      // a stale window of a few minutes on cache revalidation is fine.
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) throw new RateLimitError(`congress API 429 on ${path}`);
    if (!res.ok) throw new CongressApiError(`congress API ${res.status} on ${path}`);

    const data = (await res.json()) as T;
    if (useCache) this.cache.set(ck, { expires: Date.now() + CACHE_TTL_MS, value: data });
    return data;
  }

  /** List bills, newest first by updateDate. */
  async bills(opts: { fromDateTime?: string; limit?: number; offset?: number } = {}): Promise<import("./types").BillListResponse> {
    const params: Record<string, string> = {
      format: "json",
      sort: "updateDate+desc",
      limit: String(opts.limit ?? 250),
    };
    if (opts.offset) params.offset = String(opts.offset);
    if (opts.fromDateTime) params.fromDateTime = opts.fromDateTime;
    return this.get<import("./types").BillListResponse>("/bill", params);
  }

  /** Full detail for one bill. */
  async billDetail(congress: number, type: string, number: string): Promise<import("./types").BillDetailResponse> {
    return this.get<import("./types").BillDetailResponse>(
      `/bill/${congress}/${type.toLowerCase()}/${number}`,
      { format: "json" },
    );
  }

  /** Plain-language summaries for one bill. */
  async billSummaries(congress: number, type: string, number: string): Promise<import("./types").BillSummariesResponse> {
    return this.get<import("./types").BillSummariesResponse>(
      `/bill/${congress}/${type.toLowerCase()}/${number}/summaries`,
      { format: "json", limit: "20" },
    );
  }
}

export const congress = new CongressClient();
