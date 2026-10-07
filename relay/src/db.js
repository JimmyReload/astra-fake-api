// D1 查询层。所有 SQL 都在这里，pages.js / index.js 不直接碰 SQL。
//
// 约定：
//   * 时间一律存 unix 毫秒（INTEGER），显示时再按 GMT+8 格式化。
//   * 所有用户输入都走 .bind() 参数绑定，不做字符串拼接。
//   * 用户维度的查询一律带 user_id 条件（防越权：改别人的令牌、看别人的日志都做不到）。

import {
  DEFAULT_ITER, SESSION_TTL_MS, hashPassword, keyPrefix, newApiKey, randomId, sha256Hex,
} from "./auth.js";

const GMT8 = 8 * 3600 * 1000;
const DAY = 86400000;

export const nowMs = () => Date.now();

/** GMT+8 当天零点对应的 unix ms。站内所有「今日」都按这个算。 */
export function startOfTodayGmt8(t = Date.now()) {
  return Math.floor((t + GMT8) / DAY) * DAY - GMT8;
}

/** 把 unix ms 格式化成 "YYYY-MM-DD HH:mm"（GMT+8）。 */
export function fmtTime(ms) {
  const d = new Date(Number(ms) + GMT8);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 只要日期部分 "YYYY-MM-DD"（GMT+8）。 */
export function fmtDay(ms) {
  return fmtTime(ms).slice(0, 10);
}

// ── 账号 ──────────────────────────────────────────────────────────────────

/**
 * 建账号。**新账号余额一律 ¥0.00** —— 本站没有支付、也没有上游，
 * 送任何「体验金」都是开一张兑现不了的欠条。额度只能靠兑换码拿到。
 */
export async function createUser(env, { email, displayName, password, balance = 0, iterations = DEFAULT_ITER }) {
  const pw = await hashPassword(password, iterations);
  const t = nowMs();
  const row = await env.DB.prepare(
    `INSERT INTO users (email, display_name, pw_hash, pw_salt, pw_iter, group_name, balance, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'default', ?, 1, ?)
     RETURNING id, email, display_name, group_name, balance, created_at`,
  ).bind(email, displayName || email.split("@")[0], pw.pw_hash, pw.pw_salt, pw.pw_iter, balance, t).first();
  return row;
}

export function findUserByEmail(env, email) {
  return env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
}

export function findUserById(env, id) {
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

export function touchLogin(env, id) {
  return env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(nowMs(), id).run();
}

export function updateDisplayName(env, id, name) {
  return env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(name, id).run();
}

/** 改密码。只写新的 PBKDF2 派生值 + 新随机盐，明文不落库、也不记日志。 */
export async function changePassword(env, id, password, iterations = DEFAULT_ITER) {
  const pw = await hashPassword(password, iterations);
  return env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?")
    .bind(pw.pw_hash, pw.pw_salt, pw.pw_iter, id).run();
}

/** 改完密码把**其它**会话踢掉（当前这个留着，不然用户立刻被登出）。 */
export function deleteOtherSessions(env, userId, keepId) {
  return env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?")
    .bind(userId, keepId).run();
}

export function countUsers(env) {
  return env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
}

// ── 会话 ──────────────────────────────────────────────────────────────────

export async function createSession(env, userId, { ua = "", ip = "" } = {}) {
  const id = randomId(32);
  const t = nowMs();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, userId, t, t + SESSION_TTL_MS, String(ua).slice(0, 200), String(ip).slice(0, 60)).run();
  return id;
}

/** 用 session id 换用户。顺手把过期会话删掉（惰性清理，不需要 cron）。 */
export async function userBySession(env, sessionId) {
  if (!sessionId) return null;
  const t = nowMs();
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  ).bind(sessionId).first();
  if (!row) return null;
  if (Number(row.expires_at) <= t) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
    return null;
  }
  return row;
}

export function destroySession(env, sessionId) {
  return env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export function listSessions(env, userId) {
  return env.DB.prepare(
    "SELECT id, created_at, expires_at, ua, ip FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20",
  ).bind(userId, nowMs()).all();
}

// ── API 令牌 ──────────────────────────────────────────────────────────────

export function listTokens(env, userId) {
  return env.DB.prepare(
    "SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
  ).bind(userId).all();
}

/** 建令牌。明文 key 只在返回值里出现这一次，库里只有 SHA-256。 */
export async function createToken(env, userId, name, quota = 10) {
  const key = newApiKey();
  const hash = await sha256Hex(key);
  const t = nowMs();
  const row = await env.DB.prepare(
    `INSERT INTO tokens (user_id, name, key_prefix, key_hash, status, remain_quota, used_quota, created_at, expires_at)
     VALUES (?, ?, ?, ?, 1, ?, 0, ?, -1)
     RETURNING *`,
  ).bind(userId, String(name).slice(0, 60) || "未命名令牌", keyPrefix(key), hash, quota, t).first();
  return { token: row, key };
}

export function deleteToken(env, userId, id) {
  return env.DB.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

export function setTokenStatus(env, userId, id, status) {
  return env.DB.prepare("UPDATE tokens SET status = ? WHERE id = ? AND user_id = ?")
    .bind(status ? 1 : 0, id, userId).run();
}

/** 用明文 key 找令牌（/v1 调用时记日志用）。找不到就返回 null，不报错。 */
export async function findTokenByKey(env, key) {
  if (!key) return null;
  const hash = await sha256Hex(key);
  return env.DB.prepare("SELECT * FROM tokens WHERE key_hash = ?").bind(hash).first();
}

// ── 调用日志 ──────────────────────────────────────────────────────────────

/**
 * 记一条调用日志。**只记元数据**：模型名、token 数、耗时、状态。
 * 不记请求体、不记响应体、不记调用方 IP —— 这是有意的，站内也没有任何地方会展示它们。
 */
export function insertLog(env, { userId, tokenId = null, model, inTokens = 0, outTokens = 0, cost = 0, latencyMs = 0, status = 200 }) {
  return env.DB.prepare(
    `INSERT INTO logs (user_id, token_id, model, in_tokens, out_tokens, cost, latency_ms, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(userId, tokenId, model, inTokens, outTokens, cost, latencyMs, status, nowMs()).run();
}

/**
 * 扣余额。只在「带有效令牌的 /v1 调用」之后调用。
 * 两条硬约束：**永不为负**（SQLite 的标量 max()）、**永不阻断请求** ——
 * 这个站的 /v1 无论如何都回一张奶龙，余额扣到 0 也照回。
 */
export function spendBalance(env, userId, cost) {
  const c = Number(cost) || 0;
  if (!(c > 0)) return Promise.resolve({ success: true, meta: { changes: 0 } });
  return env.DB.prepare("UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?")
    .bind(c, userId).run();
}

/**
 * 日志筛选条件的唯一构造处。listLogs 与 sumLogs 共用，免得两处口径漂移。
 * 用户输入一律走 .bind()，这里的字符串全是常量片段。
 */
function logFilter(userId, { model = "", tokenId = 0, status = 0, since = 0 } = {}) {
  const w = ["l.user_id = ?"];
  const b = [userId];
  if (model) { w.push("l.model = ?"); b.push(String(model)); }
  if (Number(tokenId)) { w.push("l.token_id = ?"); b.push(Number(tokenId)); }
  if (Number(status)) { w.push("l.status = ?"); b.push(Number(status)); }
  if (Number(since)) { w.push("l.created_at >= ?"); b.push(Number(since)); }
  return { where: w.join(" AND "), binds: b };
}

export function listLogs(env, userId, { limit = 50, ...filter } = {}) {
  const f = logFilter(userId, filter);
  return env.DB.prepare(
    `SELECT l.*, t.name AS token_name, t.key_prefix
       FROM logs l LEFT JOIN tokens t ON t.id = l.token_id
      WHERE ${f.where}
      ORDER BY l.created_at DESC LIMIT ?`,
  ).bind(...f.binds, Math.min(Number(limit) || 50, 200)).all();
}

/** 同一筛选条件下的合计（不受分页限制，页面上显示的就是全量）。 */
export function sumLogs(env, userId, filter = {}) {
  const f = logFilter(userId, filter);
  return env.DB.prepare(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(l.in_tokens),0)  AS it,
            COALESCE(SUM(l.out_tokens),0) AS ot,
            COALESCE(SUM(l.cost),0)       AS cost
       FROM logs l WHERE ${f.where}`,
  ).bind(...f.binds).first();
}

/** 令牌的累计用量：把日志加总写回 tokens.used_quota。 */
export async function syncTokenUsage(env, userId) {
  await env.DB.prepare(
    `UPDATE tokens SET used_quota = COALESCE((
        SELECT SUM(cost) FROM logs WHERE logs.token_id = tokens.id), 0)
      WHERE user_id = ?`,
  ).bind(userId).run();
}

/** 控制台要的全部聚合，一次查完。 */
export async function statsFor(env, userId) {
  const t0 = startOfTodayGmt8();
  const d30 = t0 - 29 * DAY;

  const [totals, today, month, byModel, series, recent, avgLat] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(in_tokens+out_tokens),0) AS tk FROM logs WHERE user_id = ?",
    ).bind(userId).first(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(in_tokens+out_tokens),0) AS tk FROM logs WHERE user_id = ? AND created_at >= ?",
    ).bind(userId, t0).first(),
    env.DB.prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost FROM logs WHERE user_id = ? AND created_at >= ?",
    ).bind(userId, t0 - 29 * DAY).first(),
    env.DB.prepare(
      `SELECT model, COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost,
              COALESCE(SUM(in_tokens+out_tokens),0) AS tk,
              COALESCE(AVG(latency_ms),0) AS lat
         FROM logs WHERE user_id = ? AND created_at >= ?
        GROUP BY model ORDER BY n DESC LIMIT 8`,
    ).bind(userId, d30).all(),
    env.DB.prepare(
      `SELECT CAST((created_at + ?) / ? AS INTEGER) AS day,
              COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost
         FROM logs WHERE user_id = ? AND created_at >= ?
        GROUP BY day ORDER BY day`,
    ).bind(GMT8, DAY, userId, d30).all(),
    env.DB.prepare(
      `SELECT l.*, t.name AS token_name FROM logs l LEFT JOIN tokens t ON t.id = l.token_id
        WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 5`,
    ).bind(userId).all(),
    env.DB.prepare(
      "SELECT COALESCE(AVG(latency_ms),0) AS lat FROM logs WHERE user_id = ? AND created_at >= ?",
    ).bind(userId, d30).first(),
  ]);

  // 把稀疏的按天序列补成 30 天连续数组（图上不能断）。
  const byDay = new Map((series.results || []).map((r) => [Number(r.day), r]));
  const days = [];
  for (let i = 0; i < 30; i++) {
    const t = d30 + i * DAY;
    const key = Math.floor((t + GMT8) / DAY);
    const hit = byDay.get(key);
    days.push({ t, n: hit ? Number(hit.n) : 0, cost: hit ? Number(hit.cost) : 0 });
  }

  return {
    totals: totals || { n: 0, cost: 0, tk: 0 },
    today: today || { n: 0, cost: 0, tk: 0 },
    month: month || { n: 0, cost: 0 },
    byModel: byModel.results || [],
    days,
    recent: recent.results || [],
    avgLat: Number((avgLat && avgLat.lat) || 0),
  };
}

// ── 公告 ──────────────────────────────────────────────────────────────────

export function listAnnouncements(env, limit = 5) {
  return env.DB.prepare("SELECT * FROM announcements ORDER BY created_at DESC LIMIT ?")
    .bind(Math.min(Number(limit) || 5, 20)).all();
}

export function countLogs(env) {
  return env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS cost FROM logs").first();
}

/** 全站今日调用数（状态页用；按 GMT+8 自然日）。 */
export function countLogsToday(env) {
  return env.DB.prepare("SELECT COUNT(*) AS n FROM logs WHERE created_at >= ?")
    .bind(startOfTodayGmt8()).first();
}

// ── 兑换码 ────────────────────────────────────────────────────────────────
// 本站唯一的「充值」方式：一串预先放好的码，换固定额度。
// 没有支付流程、没有二维码、没有订单表 —— 想加钱只能有人给你一个码。
//
// 并发安全：先用一条 UPDATE ... WHERE status='unused' 原子占位，
// 只有 meta.changes === 1 的那次调用算抢到，避免同一个码被并发双花。

export async function redeemCode(env, userId, rawCode) {
  const code = String(rawCode == null ? "" : rawCode).trim().toUpperCase();
  if (!code) return { ok: false, reason: "empty" };
  if (code.length > 64) return { ok: false, reason: "not_found" };

  const t = nowMs();
  const claimed = await env.DB.prepare(
    "UPDATE redeem_codes SET status = 'used', used_by = ?, used_at = ? WHERE code = ? AND status = 'unused'",
  ).bind(userId, t, code).run();

  if (!claimed.meta || Number(claimed.meta.changes) !== 1) {
    const row = await env.DB.prepare("SELECT status FROM redeem_codes WHERE code = ?").bind(code).first();
    return { ok: false, reason: row ? "used" : "not_found" };
  }

  const row = await env.DB.prepare("SELECT amount FROM redeem_codes WHERE code = ?").bind(code).first();
  const amount = Number(row && row.amount) || 0;
  await env.DB.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").bind(amount, userId).run();
  const u = await env.DB.prepare("SELECT balance FROM users WHERE id = ?").bind(userId).first();
  return { ok: true, amount, balance: Number(u && u.balance) || 0 };
}

/** 某账号的兑换记录（充值页列表用）。 */
export function listRedeems(env, userId, limit = 20) {
  return env.DB.prepare(
    "SELECT code, amount, used_at FROM redeem_codes WHERE used_by = ? ORDER BY used_at DESC LIMIT ?",
  ).bind(userId, Math.min(Number(limit) || 20, 100)).all();
}

/** 兑换汇总：笔数 + 累计金额（不受列表分页限制）。 */
export async function redeemSummary(env, userId) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM redeem_codes WHERE used_by = ?",
  ).bind(userId).first();
  return { n: Number((r && r.n) || 0), total: Number((r && r.total) || 0) };
}
