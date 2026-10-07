// 直接开本地 D1 的 sqlite 文件核对：口令只存哈希、令牌只存 SHA-256、
// 并且把库文件当字节流搜一遍，确认明文口令 / 明文 key 一个字节都不在里面。
// 用法：node e2e_db_check.mjs <明文口令> <完整api_key>
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PW = process.argv[2] || "";
const KEY = process.argv[3] || "";
let pass = 0;
const fails = [];
const ck = (n, c, e = "") => (c ? (pass++, console.log("  PASS  " + n)) : (fails.push(n), console.log("  FAIL  " + n + (e ? " — " + e : ""))));

const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
console.log("D1 本地文件:", files.join(", "), "\n");

const hex = /^[0-9a-f]+$/;
// auth.js 用 base64url 存口令哈希/盐（不是 hex）：32 字节 dk → 43 字符，16 字节盐 → 22 字符。
const b64url = /^[A-Za-z0-9_-]+$/;
const b64len = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").length;
for (const f of files) {
  const full = join(dir, f);
  const raw = readFileSync(full);
  const db = new DatabaseSync(full, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  if (!tables.includes("users")) {
    console.log("[skip] " + f + " 没有 users 表（表：" + tables.join(",") + "）");
    db.close();
    continue;
  }
  console.log("[" + f + "] 大小 " + raw.length + " B，表：" + tables.join(", ") + "\n");

  const u = db.prepare("SELECT id,email,display_name,balance,status,pw_hash,pw_salt,pw_iter FROM users ORDER BY id DESC LIMIT 1").get();
  console.log("users 最后一行:", JSON.stringify({ ...u, pw_hash: (u.pw_hash || "").slice(0, 12) + "…", pw_salt: (u.pw_salt || "").slice(0, 12) + "…" }));
  ck(
    "pw_hash 是 base64url(32 字节 PBKDF2 输出)",
    b64url.test(u.pw_hash) && b64len(u.pw_hash) === 32,
    "len=" + (u.pw_hash || "").length + " bytes=" + b64len(u.pw_hash || ""),
  );
  ck(
    "pw_salt 是 base64url(16 字节随机盐)",
    b64url.test(u.pw_salt) && b64len(u.pw_salt) === 16,
    "len=" + (u.pw_salt || "").length + " bytes=" + b64len(u.pw_salt || ""),
  );
  ck("pw_iter 落在 [1000,60000]", u.pw_iter >= 1000 && u.pw_iter <= 60000, "iter=" + u.pw_iter);
  ck("pw_hash ≠ 明文口令", u.pw_hash !== PW, "");
  ck("库文件里没有 users 的明文口令列（表结构无 password 列）",
    !db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql.toLowerCase().includes("password"), "");

  const t = db.prepare("SELECT id,name,key_prefix,key_hash,status,used_quota FROM tokens ORDER BY id DESC LIMIT 1").get();
  console.log("tokens 最后一行:", JSON.stringify(t));
  ck("key_hash 是 64 位 hex（SHA-256）", hex.test(t.key_hash) && t.key_hash.length === 64, "len=" + (t.key_hash || "").length);
  ck("库里只存 key_prefix（15 位），没有完整 key 列",
    t.key_prefix.length === 15 && !db.prepare("SELECT sql FROM sqlite_master WHERE name='tokens'").get().sql.toLowerCase().includes("key_plain"), t.key_prefix);
  ck("used_quota 已同步（>0）", Number(t.used_quota) > 0, "used=" + t.used_quota);

  const logs = db.prepare("SELECT count(*) n FROM logs").get().n;
  ck("logs 有记录", logs >= 1, "n=" + logs);
  const rc = db.prepare("SELECT code,amount,status FROM redeem_codes").all();
  console.log("redeem_codes:", JSON.stringify(rc));
  ck("NAILONG-100 存在且已被标记 used", rc.some((r) => r.code === "NAILONG-100" && r.status === "used"), "");
  const ann = db.prepare("SELECT count(*) n FROM announcements").get().n;
  console.log("announcements 行数:", ann);

  // 最硬的一条：明文不进库
  const asText = raw.toString("latin1");
  if (PW) ck("原始库文件字节里搜不到明文口令", !asText.includes(PW), "found!");
  if (KEY) {
    ck("原始库文件字节里搜不到完整 api key", !asText.includes(KEY), "found!");
    ck("原始库文件字节里搜不到 key 的 secret 段", !asText.includes(KEY.slice(9)), "");
  }
  db.close();
}

console.log("\nPASS " + pass + " / FAIL " + fails.length);
for (const f of fails) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
