/**
 * The chat agent loop: system prompt + streamed tool-calling loop over the
 * OpenRouter free-model chain. Each turn: stream the model's reply; if it
 * called tools, execute them, feed results back, repeat (bounded). Text
 * deltas are yielded to the caller as they arrive, so the final answer
 * streams straight to the chatbox.
 */

import {
  streamChatComplete,
  type ChatMessage,
  type ToolCall,
} from "./openrouter";
import { AGENT_TOOLS, executeTool } from "./tools";

const MAX_STEPS = 4; // tool rounds per user message
const HISTORY_LIMIT = 20; // prior messages sent to the model

export function systemPrompt(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  // Congresses are 2 years, the 1st sat in 1789; 2025–2027 is the 119th.
  const congress = Math.floor((year - 1789) / 2) + 1;
  const today = now.toISOString().slice(0, 10);
  return [
    `You are the Puck Yo Bills assistant — a friendly, nonpartisan guide that helps people understand bills in the U.S. Congress.`,
    `Today is ${today}. The current Congress is the ${congress}th; bills named without a Congress number are from the current one (the previous was the ${congress - 1}th).`,
    ``,
    `You have tools backed by a live bill index synced from the official Congress.gov API. Use them — never guess bill contents, sponsors, actions, or dates.`,
    `- User names a specific bill ("explain H.R. 1", "what is S. 42 about?") → call get_bill_detail (or get_bill_summary for a shorter take) before answering.`,
    `- User asks what's happening in Congress / the Senate / the House → call get_latest_actions with the right chamber.`,
    `- User asks about a topic ("bills about housing affordability") → call search_bills — it's a semantic + keyword hybrid, so it finds relevant bills even when no word matches a title.`,
    ``,
    `Style: plain language, short paragraphs. Plain text only — no markdown formatting (no asterisks, hashes, or dash bullets). Cite bills as "H.R. 123" or "S. 45". If a tool returns an error or nothing, say what you couldn't find — do not invent facts. Stay educational and balanced; explain both what a bill does and, where relevant, the arguments around it.`,
  ].join("\n");
}

/** Shape the DB history (user/assistant text only) for the model. */
export function historyToMessages(history: { role: string; content: string }[]): ChatMessage[] {
  return history
    .slice(-HISTORY_LIMIT)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

/**
 * Run one agent turn. Yields streamed text deltas; resolves when the final
 * answer is fully streamed. `opts.signal` aborts the model call mid-turn
 * (used when the client disconnects); `opts.onModel` is called once the
 * answering model is known (used for diagnostics).
 */
export async function* runAgentTurn(
  history: ChatMessage[],
  userMessage: string,
  opts: { signal?: AbortSignal; onModel?: (model: string) => void } = {},
): AsyncGenerator<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    ...history,
    { role: "user", content: userMessage },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    let text = "";
    let toolCalls: ToolCall[] = [];
    let model = "";
    let done = false;

    for await (const ev of streamChatComplete(messages, {
      tools: AGENT_TOOLS,
      temperature: 0.3,
      maxTokens: 1200,
      signal: opts.signal,
    })) {
      if (ev.type === "text") {
        text += ev.text;
        yield ev.text;
      } else {
        model = ev.model;
        toolCalls = ev.toolCalls;
        done = true;
      }
    }
    if (!done) break; // defensive: generator ended without a done event

    if (model && opts.onModel) opts.onModel(model);

    if (toolCalls.length === 0) return; // final answer fully streamed

    // Last round: don't execute tool calls no model will ever see —
    // fall through to the honest "out of tool rounds" note instead.
    if (step === MAX_STEPS - 1) break;

    // Tool round: record the assistant's tool_calls, execute, feed back.
    messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const result = await executeTool(tc.function.name, tc.function.arguments);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  // Step budget exhausted without a final answer — say so honestly.
  const note =
    "\n\n(I ran out of tool rounds before finishing — try asking again or narrow the question.)";
  yield note;
}
