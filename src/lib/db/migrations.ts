/**
 * Migration 001 — initial schema.
 *
 * bills            one row per (congress, type, number); list-level data +
 *                 raw detail JSON, fetched lazily, served to pages.
 * sync_state       poller bookkeeping: where the last delta window ended.
 *
 * Kept deliberately small: Phase 4 adds an embeddings table (pgvector).
 */

const migration001 = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS bills (
  congress         int          NOT NULL,
  bill_type        text         NOT NULL,
  number           text         NOT NULL,
  title            text         NOT NULL,
  origin_chamber   text         NOT NULL,
  origin_chamber_code text      NOT NULL,
  introduced_date  date         NOT NULL,
  latest_action_date date,
  latest_action_text text,
  update_date      timestamptz  NOT NULL,
  update_date_including_text timestamptz,
  detail_json      jsonb,
  summary_text     text,
  fetched_at       timestamptz,
  PRIMARY KEY (congress, bill_type, number)
);

CREATE INDEX IF NOT EXISTS bills_update_date_idx ON bills (update_date DESC);
CREATE INDEX IF NOT EXISTS bills_congress_idx ON bills (congress);
CREATE INDEX IF NOT EXISTS bills_introduced_idx ON bills (introduced_date DESC);

CREATE TABLE IF NOT EXISTS sync_state (
  id               int          NOT NULL DEFAULT 1 CHECK (id = 1),
  last_window_end  timestamptz,
  last_sync_at     timestamptz,
  last_status      text,
  last_error       text,
  bills_upserted   bigint,
  PRIMARY KEY (id)
);
INSERT INTO sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;

/**
 * Migration 002 — chat session persistence (Phase 3).
 *
 * chat_sessions  one row per browser chat; the client keeps the UUID in
 *                localStorage so a conversation survives reloads.
 * chat_messages  user/assistant turns only — tool-call traffic stays
 *                in-process and is not persisted.
 */
const migration002 = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user','assistant')),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, id);
`;

export type Migration = { id: number; name: string; sql: string };

export const migrations: Migration[] = [
  { id: 1, name: "initial_schema", sql: migration001 },
  { id: 2, name: "chat_sessions", sql: migration002 },
];

/** Applies all pending migrations idempotently. */
export async function runMigrations(): Promise<string[]> {
  const { query } = await import("./index");
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id int PRIMARY KEY, name text NOT NULL, applied_at timestamptz DEFAULT now()
  )`);
  const applied = new Set(
    ((await query("SELECT id FROM schema_migrations")).rows as { id: number }[]).map((r) => r.id),
  );
  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    await query(m.sql);
    await query("INSERT INTO schema_migrations (id, name) VALUES ($1, $2)", [m.id, m.name]);
    ran.push(m.name);
  }
  return ran;
}
