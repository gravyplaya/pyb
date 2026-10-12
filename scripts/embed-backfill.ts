// One-shot embeddings backfill for local verification:
// `npx tsx scripts/embed-backfill.ts [maxBills]`
import { runMigrations } from "../src/lib/db/migrations";
import { embedPending } from "../src/lib/agent/embedder";
import { pool } from "../src/lib/db";

async function main() {
  const max = Number(process.argv[2] ?? "6000");
  const ran = await runMigrations();
  if (ran.length) console.log("migrations applied:", ran.join(", "));

  const total = await pool.query(
    `SELECT count(*)::int AS c FROM bills`,
  );
  console.log(`bills in index: ${total.rows[0].c}`);

  const r = await embedPending(max);
  console.log(
    `embedded=${r.embedded} batches=${r.batches} failedBatches=${r.failedBatches} pendingRemaining=${r.pendingRemaining}`,
  );

  const bySource = await pool.query(
    `SELECT source, count(*)::int AS c FROM bill_embeddings GROUP BY source`,
  );
  console.log("by source:", bySource.rows);
  const models = await pool.query(
    `SELECT model, count(*)::int AS c FROM bill_embeddings GROUP BY model`,
  );
  console.log("by model:", models.rows);
  await pool.end();
}

main().catch((e) => {
  console.error("backfill failed:", e);
  process.exit(1);
});
