// One-shot retention verification: inserts a synthetic stale session and a
// fresh one, runs the same DELETE the cleanup sweep runs, and checks the
// cascade. Run: node --experimental-strip-types --env-file=.env.local
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const stale = await pool.query(
    `INSERT INTO chat_sessions (last_active_at) VALUES (now() - interval '40 days') RETURNING id`,
  );
  const staleId = stale.rows[0].id;
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', 'stale test')`,
    [staleId],
  );

  const fresh = await pool.query(`INSERT INTO chat_sessions DEFAULT VALUES RETURNING id`);
  const freshId = fresh.rows[0].id;

  // Same statement as src/lib/chat/cleanup.ts cleanupOnce().
  const res = await pool.query(
    `DELETE FROM chat_sessions WHERE last_active_at < now() - make_interval(days => $1)`,
    [30],
  );

  const staleLeft = await pool.query(`SELECT 1 FROM chat_sessions WHERE id = $1`, [staleId]);
  const staleMsgs = await pool.query(`SELECT 1 FROM chat_messages WHERE session_id = $1`, [
    staleId,
  ]);
  const freshLeft = await pool.query(`SELECT 1 FROM chat_sessions WHERE id = $1`, [freshId]);

  console.log("removed:", res.rowCount);
  console.log("stale session gone:", staleLeft.rows.length === 0);
  console.log("stale messages cascaded:", staleMsgs.rows.length === 0);
  console.log("fresh session kept:", freshLeft.rows.length === 1);

  await pool.query(`DELETE FROM chat_sessions WHERE id = $1`, [freshId]); // tidy the probe row
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
