// 假中转站 · Cloudflare Worker 入口。
//
// 分四层：
//   1. 面板页（/、/login、/register、/panel、/models、/tokens、/usage、/recharge、/settings、/docs、/status、/about、/pay）
//   2. /api/* —— 真的读 D1：登录后的账号、令牌、日志、用量、兑换记录
//   3. /v1/*  —— OpenAI / Anthropic 两套外形，任何调用都返回同一张奶龙（**不校验令牌**）
//   4. 其它一切 —— 200 + 裸图。刻意不 404，这是整活的内核
//
// 唯一的「不做真事」：不接任何真实上游、不收任何钱、没有支付流程。
// 但账号是真的：注册 / 登录 / 会话 / 令牌都写 D1；口令只存 PBKDF2 派生值 + 每用户随机盐，
// 令牌只存 SHA-256。带上有效令牌的 /v1 调用会真的记一条日志、真的按倍率扣余额
// （扣到 0 也照回图 —— 记账永远不阻断出图）。
//
// ⚠️ 这个文件里没有任何 console.log —— 请求体、口令、令牌都不该出现在任何日志里。
import {
  ANNOUNCEMENTS, MODELS, aboutPage, authPage, docsPage, landing, modelsPage, panelPage,
  payPage, rechargePage, settingsPage, statusPage, tokensPage, usagePage, yuan,
} from "./pages.js";
import {
  anthropicMessage, artTokens, asMarkdownBlock, chatCompletion, countTokens, headers,
  htmlResponse, json, modelList, pickArt, responsesApi, textResponse,
} from "./nailong.js";
import * as db from "./db.js";
import {
  COOKIE_NAME, SESSION_TTL_MS, clearCookie, hashPassword, parseCookies, sessionCookie,
  validateEmail, validatePassword, verifyPassword,
} from "./auth.js";
import { clampAmount, clampChannel, makePayQr } from "./pay.js";

const VERSION = "0.3.0";
const DEFAULT_MODEL = "gpt-6-astra";

// PBKDF2 迭代次数：默认 25000。可用 wrangler.toml 的 [vars] PBKDF2_ITER 覆盖。
// 上限 60000 是**故意**的：本机实测 PBKDF2-SHA256 每 1 万次约 1.7ms，
// 免费版单次请求 CPU 上限 10ms，10 万次（16.8ms）必撞 1102。所以这里夹紧再夹紧。
const FALLBACK_ITER = 25000;
const MIN_ITER = 1000;
const MAX_ITER = 60000;
const SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

// ── 提示文案（POST 后一律 303 回跳，只把「码」放进 URL，不放自由文本）──────
// 这样做有个副作用是好事：URL 里没有用户输入，回显就不可能被塞进假文案。
const NOTICE = {
  registered: "注册成功，已经给你登录上了。新账号余额 ¥0.00 —— 额度只能靠兑换码拿。",
  loggedout: "已退出登录。",
  saved: "已保存。",
  pw: "口令已更新，其它设备上的登录状态已失效（当前这个会话保留）。",
  token_deleted: "令牌已删除。",
  token_on: "令牌已启用。",
  token_off: "令牌已禁用。",
  redeemed: "兑换成功。",
};

const ERR = {
  need_login: "请先登录。",
  no_user: "邮箱或口令不对。",
  disabled: "这个账号已被停用。",
  bad_email: "邮箱格式看起来不对。",
  bad_pw: "口令至少 8 位。",
  pw_mismatch: "两次输入的口令不一致。",
  exists: "这个邮箱已经注册过了，直接登录吧。",
  name_empty: "令牌名称不能为空。",
  code_empty: "请填写兑换码。",
  code_notfound: "这个兑换码不存在。",
  code_used: "这个兑换码已经被用过了。",
  old_pw: "当前口令不对。",
  not_found: "找不到这条记录。",
};

const apiErr = (message, status = 404) => json({ success: false, message }, status);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;
    const method = request.method;
    const art = pickArt(url.searchParams.get("art"));

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });

    // ── /v1：两套协议外形，正文永远是同一张图。**刻意不校验令牌** ─────────────
    if (path === "/v1/models") return modelList(MODELS);

    if (
      path === "/v1/chat/completions" || path === "/v1/completions" || path === "/v1/responses" ||
      path === "/v1/messages" || path === "/v1/messages/count_tokens"
    ) {
      const { model, stream } = await readRequest(request, url);
      const t0 = Date.now();
      let res;
      if (path === "/v1/responses") res = responsesApi({ model, art });
      else if (path === "/v1/messages") res = anthropicMessage({ model, art });
      else if (path === "/v1/messages/count_tokens") res = countTokens({ model, art });
      else res = chatCompletion({ model, art, stream });
      // 带了有效令牌就记一笔。不带令牌 = 没人可归属，不记（页面上的说明与此一致）。
      try {
        await logCall(env, request, { model, art, latencyMs: Date.now() - t0 });
      } catch {
        // 记账失败绝不影响出图 —— 这个站的核心承诺是「无论如何都回一张奶龙」。
      }
      return res;
    }

    // ── 会话 ────────────────────────────────────────────────────────────────
    const sid = sessionId(request);
    const me = sid ? publicUser(await db.userBySession(env, sid)) : null;

    // ── 写操作（全部 POST）──────────────────────────────────────────────────
    if (method === "POST") {
      const r = await handlePost({ request, env, url, me, sid });
      if (r) return r;
    }

    // ── /api：真数据（未登录的账号类接口返回 401）──────────────────────────
    if (path === "/api" || path.startsWith("/api/")) {
      return handleApi({ env, url, path, me });
    }

    // ── 扫码落地页：二维码里编码的就是这个 URL ──────────────────────────────
    if (path === "/pay") {
      return htmlResponse(payPage({
        amount: clampAmount(url.searchParams.get("a")),
        channel: clampChannel(url.searchParams.get("c")),
        order: String(url.searchParams.get("o") || "").slice(0, 32),
      }));
    }

    // ── 爬虫礼貌：本站是整活站，不希望被索引 ────────────────────────────────
    if (path === "/robots.txt") return textResponse("User-agent: *\nDisallow: /\n");

    // ── 面板页 ──────────────────────────────────────────────────────────────
    if (method === "GET" || method === "HEAD") {
      const page = await renderPage({ env, url, path, me, origin });
      if (page) return page;
    }

    // ── 其它一切：200 + 裸图。刻意不 404 —— 这是整活的内核 ──────────────────
    return textResponse(art);
  },
};

// ── 页面路由 ──────────────────────────────────────────────────────────────

async function renderPage({ env, url, path, me, origin }) {
  const p = path.replace(/\/+$/, "") || "/";

  // 公开页
  if (p === "/" || p === "/index.html") return htmlResponse(landing());
  if (p === "/models") return htmlResponse(modelsPage());
  if (p === "/docs") return htmlResponse(docsPage());
  if (p === "/status") return htmlResponse(statusPage());
  if (p === "/about") return htmlResponse(aboutPage());

  // 已登录就别再看登录页了
  if (p === "/login" || p === "/register") {
    if (me) return redirect("/panel");
    return htmlResponse(authPage({
      mode: p === "/register" ? "register" : "login",
      error: ERR[url.searchParams.get("error")] || "",
      notice: NOTICE[url.searchParams.get("notice")] || "",
      email: "",
      next: safeNext(url.searchParams.get("next")),
    }));
  }

  // 需要登录的页
  const authed = p === "/panel" || p === "/dashboard" || p === "/tokens" || p === "/usage" ||
    p === "/recharge" || p === "/settings";
  if (authed && !me) {
    return redirect("/login?next=" + encodeURIComponent(p === "/dashboard" ? "/panel" : p));
  }

  if (p === "/panel" || p === "/dashboard") {
    const uid = me.id;
    const [stats, tokens, anns] = await Promise.all([
      db.statsFor(env, uid),
      db.listTokens(env, uid),
      db.listAnnouncements(env, 5),
    ]);
    const rows = (anns && anns.results) || [];
    return htmlResponse(panelPage({
      user: me,
      stats,
      tokens: (tokens && tokens.results) || [],
      announcements: rows.length ? rows : ANNOUNCEMENTS,
    }));
  }

  if (p === "/tokens") {
    return htmlResponse(tokensPage(await tokensCtx(
      env, me,
      NOTICE[url.searchParams.get("notice")] || "",
      ERR[url.searchParams.get("error")] || "",
    )));
  }

  if (p === "/usage") {
    const filter = usageFilter(url);
    const [logs, tokens, summary] = await Promise.all([
      db.listLogs(env, me.id, { limit: 200, ...filter }),
      db.listTokens(env, me.id),
      db.sumLogs(env, me.id, filter),
    ]);
    return htmlResponse(usagePage({
      user: me,
      logs: (logs && logs.results) || [],
      tokens: (tokens && tokens.results) || [],
      summary,
      filter,
    }));
  }

  if (p === "/recharge") {
    const uid = me.id;
    const notice = url.searchParams.get("notice") || "";
    const [redeems, summary, stats, tokens] = await Promise.all([
      db.listRedeems(env, uid, 20),
      db.redeemSummary(env, uid),
      db.statsFor(env, uid),
      db.listTokens(env, uid),
    ]);
    return htmlResponse(rechargePage({
      user: me,
      redeems: (redeems && redeems.results) || [],
      summary,
      stats,
      tokens: (tokens && tokens.results) || [],
      payQr: makePayQr(origin, { amount: 100, channel: "alipay" }),
      notice: await redeemNotice(env, uid, notice),
      error: ERR[url.searchParams.get("error")] || "",
    }));
  }

  if (p === "/settings") {
    return htmlResponse(settingsPage({
      user: me,
      notice: NOTICE[url.searchParams.get("notice")] || "",
      error: ERR[url.searchParams.get("error")] || "",
    }));
  }

  return null;
}

/**
 * 兑换成功的提示文案**从库里取**，不从 URL 取 ——
 * 否则谁都能访问 /recharge?notice=redeemed&a=999999 看到一句伪造的「+¥9999」。
 */
async function redeemNotice(env, userId, code) {
  if (code !== "redeemed") return NOTICE[code] || "";
  const last = await db.listRedeems(env, userId, 1);
  const row = ((last && last.results) || [])[0];
  if (!row) return NOTICE.redeemed;
  return "兑换成功：" + yuan(Number(row.amount) || 0) + " 额度已经加到余额里了。";
}

async function tokensCtx(env, me, notice = "", error = "") {
  const tokens = await db.listTokens(env, me.id);
  return {
    user: me,
    tokens: (tokens && tokens.results) || [],
    notice,
    error,
  };
}

// ── POST 处理 ─────────────────────────────────────────────────────────────

async function handlePost({ request, env, url, me, sid }) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const form = await readForm(request);

  if (p === "/login") {
    const v = validateEmail(form.get("email"));
    const next = safeNext(form.get("next")) || "/panel";
    const pw = String(form.get("password") || "");
    let row = v.ok ? await db.findUserByEmail(env, v.value) : null;
    let pass = false;
    if (row) {
      pass = await verifyPassword(pw, row);
    } else {
      // 账号不存在也照样跑一遍 PBKDF2 —— 否则响应快慢会泄漏「这个邮箱注册过没有」。
      await hashPassword(pw, iterations(env));
    }
    if (!row || !pass) return redirect("/login?error=no_user" + nextQ(next));
    if (Number(row.status) !== 1) return redirect("/login?error=disabled");

    const newSid = await db.createSession(env, row.id, { ua: ua(request), ip: clientIp(request) });
    await db.touchLogin(env, row.id);
    return redirect(next, sessionCookie(newSid, SESSION_MAX_AGE));
  }

  if (p === "/register") {
    const v = validateEmail(form.get("email"));
    if (!v.ok) return redirect("/register?error=bad_email");
    const pw = validatePassword(form.get("password"));
    if (!pw.ok) return redirect("/register?error=bad_pw");
    if (String(form.get("password2") || "") !== pw.value) return redirect("/register?error=pw_mismatch");

    const exists = await db.findUserByEmail(env, v.value);
    if (exists) return redirect("/register?error=exists");

    const created = await db.createUser(env, {
      email: v.value,
      displayName: String(form.get("name") || "").trim().slice(0, 40),
      password: pw.value,
      balance: 0,
      iterations: iterations(env),
    });
    if (!created) return redirect("/register?error=bad_email");
    const newSid = await db.createSession(env, created.id, { ua: ua(request), ip: clientIp(request) });
    return redirect("/panel?notice=registered", sessionCookie(newSid, SESSION_MAX_AGE));
  }

  if (p === "/logout") {
    if (sid) await db.destroySession(env, sid);
    return redirect("/?notice=loggedout", clearCookie());
  }

  // 以下全部要求已登录
  if (!me) {
    const back = p.startsWith("/tokens") ? "/tokens" : p.startsWith("/settings") ? "/settings" : "/login";
    return redirect("/login?error=need_login&next=" + encodeURIComponent(back));
  }
  const uid = me.id;

  if (p === "/tokens") {
    const name = String(form.get("name") || "").trim().slice(0, 60);
    if (!name) return redirect("/tokens?error=name_empty");
    const q = Number(String(form.get("quota") || "").trim());
    const quota = Number.isFinite(q) && q > 0 ? Math.min(q, 1e6) : 10;
    const made = await db.createToken(env, uid, name, quota);
    // 这里**不做** 303 回跳：完整 key 只在这一次响应里出现，
    // 回跳就得把它放进 URL（进浏览器历史 / 服务器日志），那才是真的漏。
    const ctx = await tokensCtx(env, me);
    ctx.newKey = made.key;
    return htmlResponse(tokensPage(ctx));
  }

  if (p === "/tokens/delete") {
    await db.deleteToken(env, uid, Number(form.get("id")) || 0);
    await db.syncTokenUsage(env, uid);
    return redirect("/tokens?notice=token_deleted");
  }

  if (p === "/tokens/status") {
    const on = String(form.get("status")) === "1";
    await db.setTokenStatus(env, uid, Number(form.get("id")) || 0, on);
    return redirect("/tokens?notice=" + (on ? "token_on" : "token_off"));
  }

  if (p === "/redeem") {
    const r = await db.redeemCode(env, uid, form.get("code"));
    if (r.ok) return redirect("/recharge?notice=redeemed");
    const map = { empty: "code_empty", used: "code_used", not_found: "code_notfound" };
    return redirect("/recharge?error=" + (map[r.reason] || "code_notfound"));
  }

  if (p === "/settings/profile") {
    const name = String(form.get("name") || "").trim().slice(0, 40);
    await db.updateDisplayName(env, uid, name || me.email.split("@")[0]);
    return redirect("/settings?notice=saved");
  }

  if (p === "/settings/password") {
    const oldPw = String(form.get("old") || "");
    const fresh = validatePassword(form.get("new"));
    if (!fresh.ok) return redirect("/settings?error=bad_pw");
    if (String(form.get("new2") || "") !== fresh.value) return redirect("/settings?error=pw_mismatch");
    const row = await db.findUserById(env, uid);
    if (!row || !(await verifyPassword(oldPw, row))) return redirect("/settings?error=old_pw");
    await db.changePassword(env, uid, fresh.value, iterations(env));
    await db.deleteOtherSessions(env, uid, sid);
    return redirect("/settings?notice=pw");
  }

  return null;
}

// ── /api：真数据 ──────────────────────────────────────────────────────────

async function handleApi({ env, url, path, me }) {
  const p = path.replace(/\/+$/, "") || "/api";
  const ok = (data) => json({ success: true, message: "", data });

  if (p === "/api" || p === "/api/status") {
    const [users, logs, today] = await Promise.all([
      db.countUsers(env), db.countLogs(env), db.countLogsToday(env),
    ]);
    return ok({
      version: `v${VERSION}-fake`,
      site_name: "Astra Relay",
      server_address: "api.caar.fun",
      // 这三个数是真的（来自 D1）；下面的 note/disclaimer 也是真的。
      users: Number((users || {}).n) || 0,
      requests_total: Number((logs || {}).n) || 0,
      requests_today: Number((today || {}).n) || 0,
      note: "整活站：/api 下的账号数据全部来自 D1（真的），但没有任何真实上游。",
      disclaimer: "本站不收钱、不收第三方密钥、不接任何真实模型。任何 /v1 调用只会返回一张奶龙。",
    });
  }

  if (p === "/api/models") return ok(MODELS);

  if (p === "/api/pricing") {
    return ok(MODELS.map((m) => ({
      model_name: m.id,
      quota_type: 0,
      model_ratio: m.ratio,
      completion_ratio: Math.round((m.outPrice / m.inPrice) * 100) / 100,
      enable_groups: [m.group],
      status: m.status,
    })));
  }

  if (p === "/api/plans") {
    return ok([
      { amount: 10, bonus: 0 }, { amount: 50, bonus: 5 }, { amount: 100, bonus: 15 },
      { amount: 300, bonus: 60 }, { amount: 500, bonus: 120 }, { amount: 1000, bonus: 300 },
    ]);
  }

  // 充值页刷新二维码：每次请求都重新生成（新订单号 + 新盐），
  // 所以切换档位/渠道时二维码**一定**会变。刻意不要求登录 —— 充值页本身就是公开的。
  // 返回的是扁平结构（充值页内联脚本读 d.ok / d.svg / d.order / d.amount）。
  if (p === "/api/pay/qr") {
    const q = makePayQr(url.origin, {
      amount: clampAmount(url.searchParams.get("amount")),
      channel: clampChannel(url.searchParams.get("channel")),
    });
    return json({
      ok: true,
      amount: q.amount,
      channel: q.channel,
      order: q.order,
      salt: q.salt,
      url: q.url,
      svg: q.svg,
    });
  }

  if (!me) return json({ success: false, message: "未登录或会话已过期。" }, 401);
  const uid = me.id;

  if (p === "/api/user/self" || p === "/api/user") {
    const stats = await db.statsFor(env, uid);
    return ok({
      id: uid,
      email: me.email,
      display_name: me.display_name,
      group: me.group_name,
      status: Number(me.status),
      quota: Number(me.balance) || 0,
      used_quota: Number(((stats || {}).totals || {}).cost) || 0,
      request_count: Number(((stats || {}).totals || {}).n) || 0,
      created_at: me.created_at,
      last_login_at: me.last_login_at,
    });
  }

  if (p === "/api/token") {
    const t = await db.listTokens(env, uid);
    return ok(((t && t.results) || []).map((x) => ({
      id: x.id, name: x.name, key: x.key_prefix + "••••••••••••",
      status: Number(x.status), remain_quota: Number(x.remain_quota),
      used_quota: Number(x.used_quota), created_at: x.created_at, expired_time: Number(x.expires_at),
    })));
  }

  if (p === "/api/log/self" || p === "/api/log") {
    const l = await db.listLogs(env, uid, { limit: 100 });
    return ok((l && l.results) || []);
  }

  if (p === "/api/stats") return ok(await db.statsFor(env, uid));

  if (p === "/api/redeem") {
    const [rows, sum] = await Promise.all([db.listRedeems(env, uid, 50), db.redeemSummary(env, uid)]);
    return ok({ items: (rows && rows.results) || [], count: Number((sum || {}).n) || 0, total: Number((sum || {}).total) || 0 });
  }

  return apiErr("整活站：/api 下没有这个接口。会真的回你东西的是 /v1/models 与 /v1/chat/completions —— 它们回一张奶龙。");
}

// ── 小工具 ────────────────────────────────────────────────────────────────

/** PBKDF2 迭代次数：从 env 读，夹到 [1000, 60000]。 */
function iterations(env) {
  const n = Number(env && env.PBKDF2_ITER);
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_ITER;
  return Math.min(MAX_ITER, Math.max(MIN_ITER, Math.floor(n)));
}

function redirect(location, cookie) {
  const h = headers({ Location: location });
  if (cookie) h["Set-Cookie"] = cookie;
  return new Response(null, { status: 303, headers: h });
}

function sessionId(request) {
  return parseCookies(request.headers.get("Cookie"))[COOKIE_NAME] || "";
}

function ua(request) {
  return request.headers.get("User-Agent") || "";
}

/** 真 IP 由 CF 给；本地 wrangler dev 下没有这个头，就留空。 */
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "";
}

/** 剥掉口令列 —— 任何要交给页面的 user 对象都必须先过这一道。 */
function publicUser(u) {
  if (!u) return null;
  const out = {};
  for (const k of Object.keys(u)) {
    if (k === "pw_hash" || k === "pw_salt" || k === "pw_iter") continue;
    out[k] = u[k];
  }
  return out;
}

/** 只接受站内绝对路径，挡掉 //evil.com 与 http(s):// 这类跳转。 */
function safeNext(v) {
  const s = String(v == null ? "" : v);
  if (!s || s[0] !== "/" || s[1] === "/" || s[1] === "\\") return "";
  return s.slice(0, 300);
}

function nextQ(next) {
  return next && next !== "/panel" ? "&next=" + encodeURIComponent(next) : "";
}

/** /usage 的筛选参数。range 只认 1/7/30/0，换算成 created_at 下限。 */
function usageFilter(url) {
  const range = ["1", "7", "30", "0"].indexOf(String(url.searchParams.get("range"))) >= 0
    ? String(url.searchParams.get("range"))
    : "7";
  const day = 86400000;
  const t0 = db.startOfTodayGmt8();
  const since = range === "0" ? 0 : range === "1" ? t0 : range === "7" ? t0 - 6 * day : t0 - 29 * day;
  return {
    model: String(url.searchParams.get("model") || "").slice(0, 64),
    tokenId: Number(url.searchParams.get("token")) || 0,
    status: Number(url.searchParams.get("status")) || 0,
    range,
    since,
  };
}

/** 表单体：只认 application/x-www-form-urlencoded，且限长（防超大 body）。 */
async function readForm(request) {
  try {
    const raw = await request.text();
    if (!raw || raw.length > 20000) return new URLSearchParams();
    return new URLSearchParams(raw);
  } catch {
    return new URLSearchParams();
  }
}

/**
 * 记一笔调用：只在**带了有效令牌**时才写。
 * 不带令牌的调用没人可归属，所以不记 —— 这也是页面上写明的行为。
 */
async function logCall(env, request, { model, art, latencyMs }) {
  const key = bearer(request);
  if (!key) return;
  const tk = await db.findTokenByKey(env, key);
  if (!tk || Number(tk.status) !== 1) return;
  const user = await db.findUserById(env, tk.user_id);
  if (!user) return;

  const m = MODELS.find((x) => x.id === model) || MODELS[0];
  // 与响应里报的数保持一致：输入固定 9，输出按实际出图的字符数折算。
  const inTok = 9;
  const outTok = artTokens(asMarkdownBlock(art));
  const cost = Math.round(((inTok / 1e6) * m.inPrice + (outTok / 1e6) * m.outPrice) * 1e6) / 1e6;

  await db.insertLog(env, {
    userId: user.id, tokenId: tk.id, model,
    inTokens: inTok, outTokens: outTok, cost,
    latencyMs: Math.max(0, Math.round(latencyMs)), status: 200,
  });
  await db.syncTokenUsage(env, user.id);
  await db.spendBalance(env, user.id, cost);
}

function bearer(request) {
  const a = (request.headers.get("Authorization") || "").trim();
  const m = /^Bearer\s+(\S+)$/i.exec(a);
  if (m) return m[1];
  return (request.headers.get("x-api-key") || "").trim();
}

/**
 * 只为把 model 名字原样回显在响应里而读一下请求体。
 * 读到的内容**不存、不记、不转发**；解析失败一律回落默认模型，不报错。
 * （这里没有任何 console.log —— 请求体不该出现在任何日志里。）
 */
async function readRequest(request, url) {
  let model = url.searchParams.get("model") || DEFAULT_MODEL;
  let stream = url.searchParams.get("stream") === "true";
  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    try {
      const raw = await request.text();
      if (raw && raw.length < 2_000_000) {
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          if (typeof data.model === "string" && data.model.trim()) model = data.model.trim();
          if (data.stream === true) stream = true;
        }
      }
    } catch {
      // 不是 JSON 也无所谓 —— 反正答案一样
    }
  }
  return { model, stream };
}
