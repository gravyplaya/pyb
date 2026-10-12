import { NextResponse } from "next/server";

/**
 * POST /api/chat — the chatbox endpoint. The real agent (OpenRouter free-model
 * fallback chain + Congress.gov tools) is Phase 3; until it lands this returns
 * an honest placeholder so the UI works end to end.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let message = "";
  try {
    const body = (await req.json()) as { message?: unknown };
    message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  } catch {
    // fall through with empty message
  }

  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  return NextResponse.json({
    reply:
      "The chat agent is being wired up and lands in the next build — " +
      "it will answer questions about any bill using live Congress.gov data. " +
      "Meanwhile, tap any bill above for a plain-language summary.",
  });
}
