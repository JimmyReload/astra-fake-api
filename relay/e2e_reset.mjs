// 把本地 D1 里的 NAILONG-100 重置回 unused —— 兑换码是一次性的，重跑 e2e 前必须复位。
// 用法：node e2e_reset.mjs
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
let touched = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sqlite"))) {
  const full = join(dir, f);
  let db;
  try {
    db = new DatabaseSync(full);
  } catch (e) {
    console.log("[skip] " + f + " " + e.message);
    continue;
  }
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='redeem_codes'").get();
  if (!has) {
    db.close();
    continue;
  }
  const r = db.prepare("UPDATE redeem_codes SET status='unused', used_by=NULL, used_at=NULL WHERE code='NAILONG-100'").run();
  console.log(f + ": 复位 " + r.changes + " 行");
  touched += Number(r.changes) || 0;
  db.close();
}
console.log(touched ? "OK" : "没找到 NAILONG-100（迁移没跑？）");
