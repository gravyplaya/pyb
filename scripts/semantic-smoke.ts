import { hybridSearchBills } from "../src/lib/bills";
import { pool } from "../src/lib/db";

async function main() {
  for (const q of [
    "Find me bills about housing affordability",
    "bills about artificial intelligence",
    "climate change legislation",
  ]) {
    console.log(`\n=== ${q}`);
    const rows = await hybridSearchBills(q, 5);
    for (const r of rows) {
      console.log(
        `  ${r.bill_type.toUpperCase()} ${r.number} (sim=${r.similarity?.toFixed(3) ?? "-"}, from=${r.source ?? "-"}) ${r.title?.slice(0, 80)}`,
      );
    }
  }
  // Bill-number pin: "H.R. 1" must rank first.
  console.log("\n=== modernize H.R. 1 and housing");
  const pinned = await hybridSearchBills("housing and also H.R. 1", 5);
  for (const r of pinned) {
    console.log(
      `  ${r.bill_type.toUpperCase()} ${r.number} (sim=${r.similarity?.toFixed(3) ?? "-"}, from=${r.source ?? "-"}) ${r.title?.slice(0, 60)}`,
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
