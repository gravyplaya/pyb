import { billDetail, trendingBills, billsSince } from "../src/lib/bills";
import { pool } from "../src/lib/db";

async function main() {
  // HR 1 has summaries per earlier direct API check.
  const d = await billDetail(119, "HR", "1");
  console.log("DETAIL title:", d?.title?.slice(0, 60));
  console.log("DETAIL actions count:", (d?.detail as any)?.actions?.count);
  console.log("DETAIL summary len:", d?.summary_text?.length ?? 0, "(first 120:)", d?.summary_text?.slice(0, 120));

  const t = await trendingBills(5);
  console.log("TRENDING:", t.map(b => `${b.bill_type}${b.number} (${b.latest_action_date})`).join(", "));

  const s = await billsSince(undefined, 3);
  console.log("LATEST:", s.map(b => `${b.bill_type}${b.number}`).join(", "));
  const s2 = await billsSince("2026-09-23", 3);
  console.log("SINCE-23rd:", s2.length, "bills");
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
