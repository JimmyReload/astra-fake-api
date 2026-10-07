// 本地端到端验收（wrangler dev + 本地 D1）。全部走真实 HTTP，不用 mock。
// 用法：node e2e_local.mjs   （BASE 默认 http://127.0.0.1:8788）
const BASE = process.env.BASE || "http://127.0.0.1:8788";

let pass = 0;
const fails = [];
function ck(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fails.push(name + (extra ? " — " + extra : ""));
    console.log("  FAIL  " + name + (extra ? " — " + extra : ""));
  }
}

const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => k + "=" + v).join("; ");
}
function absorb(res) {
  for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (v === "" || /expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k);
    else jar.set(k, v);
  }
}
async function req(method, path, { form, json, token, redirect = "manual", headers = {} } = {}) {
  const h = { "user-agent": process.env.UA || "e2e-local-test", ...headers };
  if (jar.size) h.cookie = cookieHeader();
  let body;
  if (form) {
    h["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  } else if (json) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  if (token) h.authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { method, headers: h, body, redirect });
  absorb(res);
  const text = await res.text();
  return { res, text, status: res.status, loc: res.headers.get("location") || "", ct: res.headers.get("content-type") || "" };
}

const EMAIL = "e2e-" + Date.now() + "@example.com";
const PW = "nailong-e2e-2026";
const T0 = Date.now();
console.log("BASE=" + BASE + "\nEMAIL=" + EMAIL + "\n");

// ── 1. 注册即登录 ──────────────────────────────────────────────────────────
console.log("[1] 注册 / 会话 / 新账号余额");
let r = await req("POST", "/register", { form: { email: EMAIL, password: PW, password2: PW, name: "奶龙测试" } });
ck("POST /register → 303", r.status === 303, "status=" + r.status);
ck("注册后 Location 指向 /panel?notice=registered", r.loc === "/panel?notice=registered", "loc=" + r.loc);
ck("注册下发了会话 cookie", jar.has("astra_session"), [...jar.keys()].join(","));

r = await req("GET", "/panel");
ck("GET /panel（带会话）→ 200", r.status === 200, "status=" + r.status);
ck("新账号余额 ¥0.00（不是白送余额）", r.text.includes("¥0.00"), "");
ck("新账号无调用记录（表格为空态）", r.text.includes("还没有调用记录"), "");

r = await req("GET", "/login");
ck("已登录访问 /login → 303 /panel", r.status === 303 && r.loc === "/panel", "status=" + r.status + " loc=" + r.loc);

// ── 2. 建令牌 ─────────────────────────────────────────────────────────────
console.log("\n[2] 令牌");
r = await req("POST", "/tokens", { form: { name: "e2e-key", quota: "10" } });
ck("POST /tokens → 200 直接渲染（不回跳，key 不进 URL）", r.status === 200, "status=" + r.status);
const m = r.text.match(/sk-astra-[0-9a-f]{40}/);
ck("响应里出现完整明文 key（仅此一次）", !!m, m ? "" : "没找到 sk-astra-…");
const KEY = m ? m[0] : "";
ck("明文 key 不出现在 URL 里", !r.loc.includes("sk-astra"), "loc=" + r.loc);

// ── 3. 兑换码 ─────────────────────────────────────────────────────────────
console.log("\n[3] 兑换码 NAILONG-100");
r = await req("POST", "/redeem", { form: { code: "nailong-100" } }); // 故意小写
ck("小写兑换码也认（大小写不敏感）", r.status === 303 && r.loc === "/recharge?notice=redeemed", "loc=" + r.loc);
r = await req("GET", "/recharge?notice=redeemed");
ck("充值页显示兑换成功且金额从 D1 反查（¥100.00）", /兑换成功/.test(r.text) && r.text.includes("¥100.00"), "");
r = await req("POST", "/redeem", { form: { code: "NAILONG-100" } });
ck("同一码二次使用 → 已用过", r.loc === "/recharge?error=code_used", "loc=" + r.loc);
r = await req("POST", "/redeem", { form: { code: "NOPE-999" } });
ck("不存在的码 → code_notfound", r.loc === "/recharge?error=code_notfound", "loc=" + r.loc);

r = await req("GET", "/api/user/self");
let u = JSON.parse(r.text);
ck("兑换后余额 = 100", u.data.quota === 100, "quota=" + u.data.quota);

// ── 4. 二维码：加盐 → 切档位/渠道必变 ─────────────────────────────────────
console.log("\n[4] 二维码（/api/pay/qr）");
const q1 = JSON.parse((await req("GET", "/api/pay/qr?amount=100&channel=alipay")).text);
ck("未登录也能取二维码（公开）", q1.ok === true && typeof q1.svg === "string" && q1.svg.length > 500, JSON.stringify(Object.keys(q1)));
ck("返回扁平结构 ok/svg/order/amount（充值页内联脚本的契约）", q1.ok === true && !!q1.order && q1.amount === 100, "");
const q2 = JSON.parse((await req("GET", "/api/pay/qr?amount=100&channel=alipay")).text);
ck("同参数两次 → 盐不同（每次重新加盐）", q1.salt !== q2.salt, q1.salt + " vs " + q2.salt);
ck("同参数两次 → 二维码图不同", q1.svg !== q2.svg, "");
const q3 = JSON.parse((await req("GET", "/api/pay/qr?amount=500&channel=alipay")).text);
ck("切额度 100→500 → 二维码变", q3.svg !== q1.svg && q3.amount === 500, "");
const q4 = JSON.parse((await req("GET", "/api/pay/qr?amount=100&channel=wechat")).text);
ck("切渠道 alipay→wechat → 二维码变", q4.svg !== q1.svg && q4.channel === "wechat", "");
ck("二维码编码的 URL 带 a/c/o/s 四个参数", /\/pay\?a=\d+&c=\w+&o=\d+&s=[0-9a-f]+$/.test(q1.url), q1.url);

// ── 5. /v1 出图 + 记账 + 扣余额 ───────────────────────────────────────────
console.log("\n[5] /v1 调用：出图 + 记账 + 扣余额");
const body = { model: "gpt-6-astra", messages: [{ role: "user", content: "hello" }] };
r = await req("POST", "/v1/chat/completions", { json: body });
ck("无令牌也能调 /v1（整活内核：永远回图）", r.status === 200 && r.text.length > 200, "status=" + r.status);
ck("无令牌调用**不记账**", (await req("GET", "/api/user/self")).text.includes('"request_count":0'), "");

const before = JSON.parse((await req("GET", "/api/user/self")).text).data;
r = await req("POST", "/v1/chat/completions", { json: body, token: KEY });
const c = JSON.parse(r.text);
ck("带令牌调用 → 200 且回奶龙图", r.status === 200 && c.choices[0].message.content.length > 200, "status=" + r.status);
ck("usage 是真的按图的 token 估的（>0）", c.usage.completion_tokens > 0 && c.usage.prompt_tokens > 0, JSON.stringify(c.usage));

const after = JSON.parse((await req("GET", "/api/user/self")).text).data;
ck("调用后 request_count = 1", after.request_count === 1, "n=" + after.request_count);
ck("调用后余额被扣（<100 且 >0）", after.quota < 100 && after.quota >= 0, before.quota + " → " + after.quota);
ck("used_quota 与余额减少量一致", Math.abs(100 - after.quota - after.used_quota) < 0.0001, "used=" + after.used_quota);

const logs = JSON.parse((await req("GET", "/api/log/self")).text).data;
ck("日志表里有 1 行且字段齐全", logs.length === 1 && !!logs[0].model && !!logs[0].token_name, JSON.stringify(logs[0] || {}).slice(0, 160));
const tk = JSON.parse((await req("GET", "/api/token")).text).data;
ck("令牌 used_quota 被同步", tk.length === 1 && Number(tk[0].used_quota) > 0, JSON.stringify(tk[0] || {}).slice(0, 160));
ck(
  "令牌 key 只回 15 位前缀 + 12 个掩码点（不回完整 key）",
  tk[0] && tk[0].key.startsWith("sk-astra-") && tk[0].key.length === 27 && tk[0].key.endsWith("••••••••••••"),
  tk[0] && tk[0].key,
);
ck("掩码里不含完整 key 的其余 34 位", tk[0] && !tk[0].key.includes(KEY.slice(15, 40)), "");

// SSE
r = await req("POST", "/v1/chat/completions", { json: { ...body, stream: true }, token: KEY });
ck("stream=true → SSE 且恰好一个 [DONE]", r.ct.includes("text/event-stream") && (r.text.match(/data: \[DONE\]/g) || []).length === 1, r.ct);

// ── 6. 其它协议外形 ───────────────────────────────────────────────────────
console.log("\n[6] 多协议外形");
r = await req("GET", "/v1/models");
ck("GET /v1/models → 200 列表", r.status === 200 && JSON.parse(r.text).data.length >= 6, "status=" + r.status);
r = await req("POST", "/v1/messages", { json: { model: "claude-x", messages: [] } });
ck("POST /v1/messages（Anthropic 外形）→ 200", r.status === 200 && JSON.parse(r.text).type === "message", "status=" + r.status);
r = await req("POST", "/v1/responses", { json: { model: "gpt-6-astra", input: "hi" } });
ck("POST /v1/responses（Responses 外形）→ 200", r.status === 200, "status=" + r.status);
r = await req("POST", "/v1/messages/count_tokens", { json: { model: "claude-x", messages: [] } });
ck("POST /v1/messages/count_tokens → 200", r.status === 200 && typeof JSON.parse(r.text).input_tokens === "number", "status=" + r.status);

// ── 7. 静态资源（[assets] 绑定）───────────────────────────────────────────
console.log("\n[7] 静态资源 / 扫码落地页");
r = await req("GET", "/1768402480_3412972.png");
ck("GET /1768402480_3412972.png → 200 image/png", r.status === 200 && r.ct.includes("image/png"), "status=" + r.status + " ct=" + r.ct);
ck("图片字节数 ≈ 291872", r.text.length > 100000, "len=" + r.text.length);
r = await req("GET", "/pay?a=100&c=alipay&o=20261007192008672");
ck("扫码落地页 → 200 且引用了那张图", r.status === 200 && r.text.includes("/1768402480_3412972.png"), "status=" + r.status);
ck("落地页如实说明（没有付款/订单/收款方）", /没有付款/.test(r.text) && /没有收款方/.test(r.text), "");

// ── 8. 公开页与 /api 边界 ─────────────────────────────────────────────────
console.log("\n[8] 公开页 / /api 边界 / 兜底");
for (const p of ["/", "/models", "/docs", "/status", "/about"]) {
  const rr = await req("GET", p);
  ck("GET " + p + " → 200", rr.status === 200 && rr.text.length > 800, "status=" + rr.status + " len=" + rr.text.length);
}
r = await req("GET", "/api/status");
ck("/api/status 返回真实计数（users>=1）", JSON.parse(r.text).data.users >= 1, r.text.slice(0, 120));
r = await req("GET", "/robots.txt");
ck("/robots.txt → Disallow: /", /Disallow: \//.test(r.text), "");
r = await req("OPTIONS", "/v1/chat/completions");
ck("OPTIONS → 204 + CORS *", r.status === 204 && r.res.headers.get("access-control-allow-origin") === "*", "status=" + r.status);
r = await req("GET", "/api/definitely-not-a-route");
const unkJ = JSON.parse(r.text);
ck("未知 /api/* → 404 JSON", r.status === 404 && unkJ.success === false, "status=" + r.status);
ck("未知 /api/* 的文案点明这是整活站", typeof unkJ.message === "string" && unkJ.message.includes("整活站"), unkJ.message);
r = await req("GET", "/some/random/path");
ck("未知路径 → 200 + 裸图（刻意不 404）", r.status === 200 && r.text.length > 200, "status=" + r.status);

// 未登录 401
const savedJar = new Map(jar);
jar.clear();
r = await req("GET", "/api/user/self");
ck("未登录 /api/user/self → 401 JSON", r.status === 401 && JSON.parse(r.text).success === false, "status=" + r.status);
r = await req("GET", "/panel");
ck("未登录 /panel → 303 /login?next=%2Fpanel", r.status === 303 && r.loc === "/login?next=%2Fpanel", "loc=" + r.loc);
r = await req("POST", "/login", { form: { email: EMAIL, password: "wrong-password-xyz" } });
ck("错误口令 → error=no_user", r.status === 303 && r.loc.startsWith("/login?error=no_user"), "loc=" + r.loc);
r = await req("POST", "/login", { form: { email: "nobody-" + Date.now() + "@example.com", password: "whatever-1234" } });
ck("不存在的账号也走 PBKDF2（响应语义一致）", r.loc.startsWith("/login?error=no_user"), "loc=" + r.loc);
r = await req("POST", "/register", { form: { email: EMAIL, password: PW, password2: PW } });
ck("重复注册 → error=exists", r.loc === "/register?error=exists", "loc=" + r.loc);
jar.clear();
for (const [k, v] of savedJar) jar.set(k, v);

// ── 9. 改口令 ─────────────────────────────────────────────────────────────
console.log("\n[9] 改口令");
r = await req("POST", "/settings/password", { form: { old: "wrong", new: "newpassword123", new2: "newpassword123" } });
ck("旧口令错 → error=old_pw", r.loc === "/settings?error=old_pw", "loc=" + r.loc);
r = await req("POST", "/settings/password", { form: { old: PW, new: "short", new2: "short" } });
ck("新口令太短 → error=bad_pw", r.loc === "/settings?error=bad_pw", "loc=" + r.loc);
r = await req("POST", "/settings/password", { form: { old: PW, new: "nailong-new-2026", new2: "nailong-new-2026" } });
ck("改口令成功 → notice=pw", r.loc === "/settings?notice=pw", "loc=" + r.loc);
ck("改口令后当前会话仍有效（不被踢）", jar.has("astra_session") && (await req("GET", "/panel")).status === 200, "");

// ── 10. 登出 ──────────────────────────────────────────────────────────────
console.log("\n[10] 登出");
r = await req("POST", "/logout");
ck("POST /logout → 303 /?notice=loggedout", r.status === 303 && r.loc === "/?notice=loggedout", "loc=" + r.loc);
ck("登出后 cookie 被清除", !jar.has("astra_session"), [...jar.keys()].join(","));
r = await req("GET", "/panel");
ck("登出后 /panel 又跳登录页", r.status === 303 && r.loc.startsWith("/login"), "loc=" + r.loc);

const dt = ((Date.now() - T0) / 1000).toFixed(1);
console.log("\n════════════════════════════════════");
console.log("PASS " + pass + " / FAIL " + fails.length + "   (" + dt + "s)");
for (const f of fails) console.log("  FAIL " + f);
console.log("EMAIL=" + EMAIL + "  KEY=" + KEY);
process.exit(fails.length ? 1 : 0);
