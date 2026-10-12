import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { historyToMessages, runAgentTurn } from "@/lib/agent/agent";

/**
 * POST /api/chat — the real agent (Phase 3): OpenRouter free-model fallback
 * chain + Congress.gov/DB tools, streamed as plain text. The conversation
 * persists in Postgres; the client keeps the session UUID (X-Session-Id) in
 * localStorage and GETs the history back on reload.
 *
 * Replaces the old n8n `chat` webhook — the last n8n dependency in the path.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-IP sliding window: POST /api/chat is public and drives OpenRouter +
// Congress.gov + Postgres, so one client can't monopolize the free-model key.
// In-memory per server instance — good enough for the single-container deploy.
const RATE_LIMIT = 10; // messages…
const RATE_WINDOW_MS = 60_000; // …per rolling minute per IP
const rateHits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function allowRequest(ip: string): boolean {
  const now = Date.now();
  if (rateHits.size > 5_000) {
    for (const [k, v] of rateHits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) rateHits.delete(k);
    }
  }
  const recent = (rateHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rateHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateHits.set(ip, recent);
  return true;
}

/** GET /api/chat?sessionId=… — restore a conversation after a reload. */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ sessionId: null, messages: [] });
  }
  try {
    const rows = await query<{ role: string; content: string }>(
      `SELECT role, content FROM chat_messages
       WHERE session_id = $1 ORDER BY id ASC LIMIT 100`,
      [sessionId],
    );
    return NextResponse.json({ sessionId, messages: rows.rows });
  } catch (e) {
    console.error("[pyb] chat history load failed:", e);
    return NextResponse.json({ sessionId: null, messages: [] });
  }
}

/** Ensure the session row exists; returns its id. */
async function ensureSession(sessionId: string | null): Promise<string> {
  if (sessionId && UUID_RE.test(sessionId)) {
    // Only trust ids that actually exist (avoids FK errors on stale ids).
    const found = await query<{ id: string }>(
      `SELECT id FROM chat_sessions WHERE id = $1`,
      [sessionId],
    );
    if (found.rows.length) {
      await query(`UPDATE chat_sessions SET last_active_at = now() WHERE id = $1`, [sessionId]);
      return sessionId;
    }
  }
  const created = await query<{ id: string }>(
    `INSERT INTO chat_sessions (id) VALUES (DEFAULT) RETURNING id`,
  );
  return created.rows[0].id;
}

export async function POST(req: Request) {
  if (!allowRequest(clientIp(req))) {
    return NextResponse.json(
      { error: "Too many messages — take a breath and try again in a minute." },
      { status: 429 },
    );
  }

  let message = "";
  let sessionId: string | null = null;
  try {
    const body = (await req.json()) as { message?: unknown; sessionId?: unknown };
    message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  } catch {
    // fall through with empty message
  }
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  try {
    sessionId = await ensureSession(sessionId);
  } catch (e) {
    console.error("[pyb] chat session create failed:", e);
    return NextResponse.json({ error: "Chat storage unavailable" }, { status: 500 });
  }
  const sid = sessionId;

  // History for the model, persisted user message for the transcript.
  let history: { role: string; content: string }[] = [];
  try {
    const rows = await query<{ role: string; content: string }>(
      `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY id DESC LIMIT 20`,
      [sid],
    );
    history = rows.rows.reverse();
    await query(`INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`, [
      sid,
      message,
    ]);
  } catch (e) {
    // Chat still works without persistence rather than failing the turn.
    console.error("[pyb] chat history load/save failed:", e);
    history = [];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      let clientGone = false;
      // Aborting the agent when the client disconnects stops burning
      // OpenRouter/Congress.gov quota for nobody; whatever streamed so far
      // still persists below.
      const abortAgent = new AbortController();
      const push = (text: string) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          clientGone = true;
          abortAgent.abort();
        }
      };
      req.signal.addEventListener(
        "abort",
        () => {
          clientGone = true;
          abortAgent.abort();
        },
        { once: true },
      );

      try {
        for await (const delta of runAgentTurn(historyToMessages(history), message, {
          signal: abortAgent.signal,
        })) {
          reply += delta;
          push(delta);
        }
      } catch (e) {
        if (!abortAgent.signal.aborted) {
          console.error("[pyb] agent turn failed:", e);
          const note =
            "\n\n(Sorry — the assistant couldn't finish that answer. Please try again.)";
          reply += note;
          push(note);
        }
      } finally {
        // The client may be gone (canceled stream): close() throws then,
        // and that must never skip the persist below.
        try {
          controller.close();
        } catch {
          // already closed/canceled — nothing to do
        }
        if (reply.trim()) {
          try {
            await query(
              `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
              [sid, reply.trim()],
            );
          } catch (e) {
            console.error("[pyb] assistant message persist failed:", e);
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Session-Id": sid,
    },
  });
}
