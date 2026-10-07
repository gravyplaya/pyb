// One-shot migration runner for local verification: `npx tsx scripts/migrate.ts`
import { runMigrations } from "../src/lib/db/migrations";
import { pool } from "../src/lib/db";

async function main() {
  const ran = await runMigrations();
  console.log(ran.length ? `applied: ${ran.join(", ")}` : "nothing to apply");
  const r = await pool.query("SELECT id, name, applied_at FROM schema_migrations ORDER BY id");
  console.log("schema_migrations:", r.rows);
  await pool.end();
}

main().catch((e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
