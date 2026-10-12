"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const SESSION_KEY = "pyb-chat-session";

/**
 * Streams the agent's reply from POST /api/chat token by token, and keeps the
 * conversation across reloads: the server-issued session id (X-Session-Id)
 * lives in localStorage and the history is replayed from Postgres on mount.
 */
export default function ChatBox() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Restore the prior conversation once per mount.
  useEffect(() => {
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      setRestored(true);
      return;
    }
    sessionRef.current = sid;
    fetch(`/api/chat?sessionId=${encodeURIComponent(sid)}`)
      .then((r) => r.json())
      .then((d: { sessionId: string | null; messages?: { role: string; content: string }[] }) => {
        if (d.sessionId && Array.isArray(d.messages) && d.messages.length > 0) {
          setMessages(
            d.messages
              .filter(
                (m): m is { role: string; content: string } =>
                  (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
              )
              .map((m) => ({ role: m.role as Msg["role"], text: m.content })),
          );
        }
      })
      .catch(() => {
        // History is best-effort; a fresh chat is fine.
      })
      .finally(() => setRestored(true));
  }, []);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    // `restored` gates the send so a returning visitor can't fire a turn
    // while the history replay is still in flight — that would get clobbered
    // by the restore's setMessages below.
    if (!text || busy || !restored) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sessionRef.current }),
      });

      const sid = r.headers.get("X-Session-Id");
      if (sid) {
        sessionRef.current = sid;
        localStorage.setItem(SESSION_KEY, sid);
      }

      if (!r.ok || !r.body) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setMessages((m) =>
          m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, text: data.error ?? "Something went wrong — try again." }
              : msg,
          ),
        );
        return;
      }

      // Consume the plain-text stream into the last message bubble.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) =>
          m.map((msg, i) => (i === m.length - 1 ? { ...msg, text: acc } : msg)),
        );
      }
      if (!acc.trim()) {
        setMessages((m) =>
          m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, text: "The assistant returned an empty answer — try again." }
              : msg,
          ),
        );
      }
    } catch {
      setMessages((m) =>
        m.map((msg, i) =>
          i === m.length - 1
            ? { ...msg, text: "Couldn't reach the server — try again." }
            : msg,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl rounded-xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur">
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">
        Ask about any bill
      </h2>

      <div ref={scrollRef} className="max-h-96 min-h-[3rem] space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            {restored
              ? "Ask questions about any bill in Congress and get clear, straightforward answers."
              : "Loading your conversation…"}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto w-fit max-w-[85%] rounded-lg bg-blue-900 px-3 py-2 text-sm text-white"
                : "w-fit max-w-[85%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700"
            }
          >
            {m.text.trim() || (busy && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What is H.R. 1 about?"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-800"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={busy || !restored || !input.trim()}
          className="rounded-md bg-amber-400 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}
