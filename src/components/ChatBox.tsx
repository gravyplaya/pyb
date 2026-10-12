"use client";

import { useState } from "react";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = (await r.json()) as { reply?: string; error?: string };
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.reply ?? data.error ?? "Something went wrong — try again.",
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Couldn't reach the server — try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl rounded-xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur">
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">
        Ask about any bill
      </h2>

      <div className="min-h-[3rem] space-y-2 px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            Ask questions about any bill in Congress and get clear, straightforward answers.
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
            {m.text}
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
          disabled={busy || !input.trim()}
          className="rounded-md bg-amber-400 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </section>
  );
}
