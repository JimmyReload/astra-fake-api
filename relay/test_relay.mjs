// 假中转站的本地验收：直接 import Worker 模块，用 Request/Response 打全套路由。
// 运行：node relay/test_relay.mjs
//
// 除功能外，这里还刻意加了「逼真但诚实」的**静态自检**（见 D 组）——
// 那几条不是形式主义：页面写明了"密码只存 PBKDF2 派生值"，那就必须能被机器验出来。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import worker from "./src/index.js";
import { ART_HD } from "./src/art.js";
import { MODELS } from "./src/pages.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  [√] ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  [x] ${name}${detail ? " — " + detail : ""}`);
  }
}

const BASE = "https://api.caar.fun";
const req = (path, init = {}) => new Request(BASE + path, init);

/**
 * 内存 stub D1。这个套件是**离线协议层**自检，不该依赖真库或 wrangler dev，
 * 所以只实现 worker 实际用到的调用形态（prepare().bind().first()/all()/run()）。
 * 默认一律返回空结果 —— /api/status 于是报 0 用户 0 调用，页面走空态分支。
 * 需要真库行为的用例（注册/登录/令牌/记账）归 relay/_e2e_local.mjs，它打真 D1。
 */
function stubD1() {
  const stmt = (sql) => {
    const api = {
      bind: () => api,
      first: async () => (/COUNT\(\*\)/i.test(sql) ? { n: 0 } : null),
      all: async () => ({ results: [], success: true, meta: {} }),
      run: async () => ({ success: true, meta: { changes: 0 } }),
    };
    return api;
  };
  return { prepare: (sql) => stmt(sql), batch: async () => [], exec: async () => ({}) };
}

const ENV = { DB: stubD1(), PBKDF2_ITER: "25000" };

const get = async (path, init) => worker.fetch(req(path, init), ENV);

const post = (path, body) =>
  worker.fetch(
    req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ENV,
  );

// 基准图（去尾换行），用于逐字节比对
const baseArt = readFileSync(join(ROOT, "art_hd.txt"), "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
const FENCED = "```\n" + baseArt + "\n```";

// 页脚小字声明的关键句（全站唯一「明说」位置，除 /about 外）。改文案必须同步改这里。
const DISCLOSURE = "个人整活项目";

console.log("A. 页面");
{
  // 未登录就能看的公开页（必须 200）。
  const publicPages = [
    ["/", "接入全球主流大模型"],
    ["/login", "欢迎回到 Astra Relay"],
    ["/register", "创建 Astra Relay 账号"],
    ["/models", "模型广场"],
    ["/docs", "接口文档"],
    ["/status", "服务状态"],
    ["/about", "不接任何真实上游"],
    ["/pay", "扫码结果"],
  ];
  for (const [path, needle] of publicPages) {
    const res = await get(path);
    const body = await res.text();
    check(
      `GET ${path} → 200 text/html 且含「${needle}」`,
      res.status === 200 && (res.headers.get("Content-Type") || "").includes("text/html") && body.includes(needle),
      `status=${res.status} ct=${res.headers.get("Content-Type")} len=${body.length}`,
    );
    check(`GET ${path} 带页脚诚实声明`, body.includes(DISCLOSURE) && body.includes("Cloudflare D1"), "页脚声明缺失");
  }
  // 登录后页面：未登录必须 303 跳登录 —— 不能 200 渲染一个空壳（那才是"假装有账号"）。
  for (const path of ["/panel", "/tokens", "/usage", "/recharge", "/settings"]) {
    const res = await get(path);
    const loc = res.headers.get("Location") || "";
    check(
      `未登录 GET ${path} → 303 到 /login?next=`,
      res.status === 303 && loc.startsWith("/login?next="),
      `status=${res.status} loc=${loc}`,
    );
  }
}

console.log("\nA2. 页面标题不含「假的 / 整活 / 奶龙」等露馅词");
{
  // <title> 是浏览器标签与搜索结果里看到的东西，必须像真的 —— 对所有公开页成立。
  // 正文里的「露馅词」只对纯营销页（首页 / 模型广场）禁止：页脚、/about、/login、/pay
  // 是**主动自白**的位置，允许直说（诚实优先于"像"）。
  const stripFooter = (h) => h.replace(/<footer[\s\S]*?<\/footer>/g, "");
  for (const path of ["/", "/login", "/register", "/models", "/docs", "/status", "/about", "/pay"]) {
    const body = await (await get(path)).text();
    const title = (body.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    check(`GET ${path} 的 <title> 不含露馅词`, !/假|整活|奶龙/.test(title), title);
  }
  for (const path of ["/", "/models"]) {
    const body = await (await get(path)).text();
    const shell = stripFooter(body);
    const hits = shell.match(/假的|整活|奶龙|不收钱/g) || [];
    // 首页允许自白（诚实优先于「像」），但自白必须**伴随说明** —— 不能只丢一个「奶龙」了事。
    const honest = /不接任何真实上游|D1 里的一个数|只返回一张奶龙 ASCII 图/.test(shell);
    check(`GET ${path} 正文里的自白必须伴随诚实说明`, hits.length === 0 || honest, hits.join("、") + (honest ? "" : "（缺说明）"));
  }
}

console.log("\nB. /v1 两套协议");
{
  const res = await get("/v1/models");
  const data = await res.json();
  check("GET /v1/models → object=list", data.object === "list");
  check(`GET /v1/models 返回 ${MODELS.length} 个模型`, data.data.length === MODELS.length, `实际 ${data.data.length}`);
  check("GET /v1/models 的 id 与页面清单一致", data.data.map((m) => m.id).join() === MODELS.map((m) => m.id).join());

  const chat = await (await post("/v1/chat/completions", { model: "gpt-6-astra", messages: [{ role: "user", content: "你好" }] })).json();
  check("POST /v1/chat/completions → object=chat.completion", chat.object === "chat.completion");
  check("chat 正文 = 三反引号围栏 + 基准图", chat.choices[0].message.content === FENCED, `len=${chat.choices[0].message.content.length} vs ${FENCED.length}`);
  check("chat 回显请求里的 model", chat.model === "gpt-6-astra", chat.model);
  check("chat finish_reason=stop", chat.choices[0].finish_reason === "stop");

  const noModel = await (await post("/v1/chat/completions", { messages: [] })).json();
  check("不传 model → 回落默认 gpt-6-astra", noModel.model === "gpt-6-astra", noModel.model);

  const bogus = await (await post("/v1/chat/completions", { model: "完全不存在的模型" })).json();
  check("乱填 model 也回奶龙（不 404）", bogus.choices[0].message.content === FENCED, "本站在这一点上刻意与主服务不同");

  const resp = await (await post("/v1/responses", { model: "gpt-6-luna", input: "hi" })).json();
  check("POST /v1/responses → output_text = 围栏图", resp.object === "response" && resp.output_text === FENCED);
  check("responses 的 output[0] 形状正确", resp.output[0].type === "message" && resp.output[0].content[0].text === FENCED);

  const msg = await (await post("/v1/messages", { model: "gpt-6-astra", messages: [] })).json();
  check("POST /v1/messages → content[0].text = 围栏图", msg.type === "message" && msg.content[0].text === FENCED);
  check("messages stop_reason=end_turn", msg.stop_reason === "end_turn");

  const ct = await (await post("/v1/messages/count_tokens", { model: "gpt-6-astra" })).json();
  check("POST /v1/messages/count_tokens 返回 input_tokens>0", typeof ct.input_tokens === "number" && ct.input_tokens > 0, JSON.stringify(ct));

  // 流式
  const sres = await post("/v1/chat/completions", { model: "gpt-6-astra", stream: true });
  const sbody = await sres.text();
  check("流式 Content-Type = text/event-stream", (sres.headers.get("Content-Type") || "").includes("text/event-stream"));
  const doneCount = (sbody.match(/^data: \[DONE\]$/gm) || []).length;
  check("流式恰好一个 data: [DONE]", doneCount === 1, `实际 ${doneCount}`);
  const frames = sbody.split("\n\n").filter((f) => f.startsWith("data: ") && !f.includes("[DONE]"));
  let acc = "";
  let usageFrames = 0;
  let chunkObjects = new Set();
  for (const f of frames) {
    const o = JSON.parse(f.slice(6));
    chunkObjects.add(o.object);
    if (o.choices.length === 0) {
      usageFrames++;
      continue;
    }
    acc += o.choices[0].delta.content ?? "";
  }
  check("流式帧全是 chat.completion.chunk", chunkObjects.size === 1 && chunkObjects.has("chat.completion.chunk"));
  check("流式拼接结果 = 围栏图", acc === FENCED, `len=${acc.length} vs ${FENCED.length}`);
  check("流式恰好一个 usage 收尾帧", usageFrames === 1, `实际 ${usageFrames}`);
}

console.log("\nC. /api 面板 + 兜底路由");
{
  // 公开的 /api（不需要登录）：站点概况与价目表
  for (const p of ["/api/status", "/api", "/api/models", "/api/pricing", "/api/plans"]) {
    const res = await get(p);
    const j = await res.json();
    check(`GET ${p} → success=true`, res.status === 200 && j.success === true, JSON.stringify(j).slice(0, 120));
  }
  // 支付二维码接口是**故意**公开的（扫码的是另一个设备，不可能带 cookie），所以放在 401 闸门之前。
  const qr = await (await get("/api/pay/qr?amount=500&channel=wechat")).json();
  check(
    "/api/pay/qr → 带盐的真 QR（公开，无需登录）",
    qr.ok === true &&
      typeof qr.svg === "string" &&
      qr.svg.includes("<svg") &&
      qr.amount === 500 &&
      qr.channel === "wechat" &&
      typeof qr.salt === "string" &&
      qr.salt.length > 0 &&
      qr.url.includes("s=" + qr.salt),
    JSON.stringify(qr).slice(0, 160),
  );
  const qr2 = await (await get("/api/pay/qr?amount=500&channel=wechat")).json();
  check("/api/pay/qr 每次换新盐 ⇒ 同一个额度也出不同码", qr2.salt !== qr.salt, `${qr.salt} vs ${qr2.salt}`);

  const st = await (await get("/api/status")).json();
  check("/api/status 自带免责声明（含「奶龙」）", typeof st.data.disclaimer === "string" && st.data.disclaimer.includes("奶龙"));

  // 需要登录的 /api：未登录必须 401（而不是回一份假数据）
  for (const p of ["/api/user/self", "/api/token/", "/api/log/self", "/api/stats"]) {
    const res = await get(p);
    const j = await res.json();
    check(
      `未登录 GET ${p} → 401 且 success=false`,
      res.status === 401 && j.success === false,
      `status=${res.status} ${JSON.stringify(j).slice(0, 100)}`,
    );
  }

  // 未登录时连**未知** /api 路径也走 401 闸门 —— 不向外泄露路由表。
  // （登录后才有 404 + 「整活站」文案，那条需要真库会话，归 relay/_e2e_local.mjs。）
  const nope = await get("/api/whatever");
  const nopeJ = await nope.json();
  check(
    "未登录 GET /api/whatever → 401（不泄露路由表）",
    nope.status === 401 && nopeJ.success === false,
    `status=${nope.status} ${JSON.stringify(nopeJ).slice(0, 80)}`,
  );

  const rb = await get("/robots.txt");
  check("GET /robots.txt → Disallow", (await rb.text()).includes("Disallow: /"));

  const opt = await worker.fetch(req("/v1/chat/completions", { method: "OPTIONS" }), ENV);
  check("OPTIONS → 204 + CORS", opt.status === 204 && opt.headers.get("Access-Control-Allow-Origin") === "*");

  for (const p of ["/完全不存在", "/v1/不存在", "/favicon.ico", "/a/b/c"]) {
    const res = await get(p);
    const body = await res.text();
    check(`GET ${p} → 200 + 裸图（不 404）`, res.status === 200 && body === baseArt, `status=${res.status} len=${body.length}`);
  }
}

console.log("\nD. 「逼真但诚实」静态自检（页面上那些承诺的机器判据）");
{
  const pagesSrc = readFileSync(join(HERE, "src", "pages.js"), "utf8");
  const indexSrc = readFileSync(join(HERE, "src", "index.js"), "utf8");
  const nailongSrc = readFileSync(join(HERE, "src", "nailong.js"), "utf8");
  const authSrc = readFileSync(join(HERE, "src", "auth.js"), "utf8");
  const dbSrc = readFileSync(join(HERE, "src", "db.js"), "utf8");
  const paySrc = readFileSync(join(HERE, "src", "pay.js"), "utf8");
  const qrSrc = readFileSync(join(HERE, "src", "qr.js"), "utf8");
  const migSql = readFileSync(join(HERE, "migrations", "0001_init.sql"), "utf8");
  const allSrc = pagesSrc + indexSrc + nailongSrc + authSrc + dbSrc + paySrc + qrSrc;

  // ① 登录是**真的**（用户 2026-10-07 明确要求「登录也真接数据库」）。
  // 这几条此前是反过来的（断言"表单没有 action="）——语义已随需求翻转，改文案必须同步改这里。
  check("登录表单真的 POST 到 /login", /action\s*=\s*"\/login"/.test(pagesSrc));
  check("注册表单真的 POST 到 /register", /action\s*=\s*"\/register"/.test(pagesSrc));
  check("登录页如实写明邮箱与密码会真的存进 D1", pagesSrc.includes("真的会存进 Cloudflare D1") || pagesSrc.includes("会写进 Cloudflare D1"));
  check("登录页写明只存 PBKDF2 派生值、不保存明文", /PBKDF2[\s\S]{0,80}不保存明文/.test(pagesSrc));
  check("登录页提醒不要用真实在用的密码", /不要使用你在别处正在用的密码/.test(pagesSrc));

  // ② 口令与令牌的存储形状：只存派生值，库里没有任何明文列
  check("users 表存 pw_hash / pw_salt / pw_iter", /pw_hash/.test(migSql) && /pw_salt/.test(migSql) && /pw_iter/.test(migSql));
  check("users 表没有明文 password 列", !/\bpassword\s+(TEXT|VARCHAR)/i.test(migSql));
  check("tokens 表只存 key_hash 与 key_prefix", /key_hash/.test(migSql) && /key_prefix/.test(migSql));
  check("auth.js 用 PBKDF2 + 每账号随机盐派生口令", authSrc.includes("pbkdf2") && authSrc.includes("b64urlEncode") && authSrc.includes("randomId"));
  check("API key 只存 SHA-256（sha256Hex）", authSrc.includes("sha256Hex"));
  check("所有 SQL 都住在 db.js 一处", /env\.DB\.prepare/.test(dbSrc) && !/env\.DB\.prepare/.test(indexSrc));

  // ③ 页面里唯一的网络请求是充值页取二维码 —— 不是偷偷上报
  const fetchCount = (pagesSrc.match(/\bfetch\s*\(/g) || []).length;
  check("页面里的 fetch 只有充值页取二维码这一处", fetchCount === 1 && pagesSrc.includes('fetch("/api/pay/qr'));
  check("页面里没有 XMLHttpRequest / sendBeacon", !/XMLHttpRequest|sendBeacon/.test(pagesSrc));
  check("index.js / pages.js 里没有 localStorage / sessionStorage", !/localStorage|sessionStorage/.test(indexSrc + pagesSrc));

  // ④ 支付二维码：独立 QR 模块（v7 / 45×45）+ 载荷带盐
  check("QR 模块自报 v7 / 45×45", qrSrc.includes("QR_VERSION = 7") && qrSrc.includes("QR_SIZE = 45"));
  check("pay.js 的载荷带 额度/渠道/订单号/盐 四参", paySrc.includes('"/pay?a="') && paySrc.includes("&c=") && paySrc.includes("&o=") && paySrc.includes("&s="));
  check("每次取二维码都换新盐（newSalt）", paySrc.includes("newSalt") && indexSrc.includes("makePayQr"));

  // ⑤ 不加载任何第三方资源（只认**资源加载**形态；<a href> 是普通导航，不算）
  const externalResources = pagesSrc.match(/(?:src|srcset)\s*=\s*["']https?:\/\/|<link[^>]*href\s*=\s*["']https?:\/\/|@import\s+url\(|url\(\s*["']?https?:\/\//g) || [];
  check("不加载任何第三方资源（脚本/图片/字体/样式）", externalResources.length === 0, externalResources.join(", "));

  // ⑥ 请求体不进日志
  check("全站没有任何 console 调用（只认真正的调用形态）", !/console\.(log|info|debug|warn|error)\s*\(/.test(allSrc));

  // ⑦ 诚实声明必须在场（页脚 + /about + 充值页）
  check("响应头带 X-Relay-Note（对外声明这是整活站）", nailongSrc.includes("X-Relay-Note"));
  check("页脚小字声明在 FOOTER 常量里（每页都有）", pagesSrc.includes("const FOOTER") && pagesSrc.includes(DISCLOSURE));
  check("页脚声明写明：不接真实上游 / 不接受付款", /不接任何真实模型上游/.test(pagesSrc) && /不接受任何付款/.test(pagesSrc));
  check("关于页写明「它真的存了什么」", pagesSrc.includes("它真的存了什么"));
  check("关于页写明数据库是 D1、迁移脚本在仓库里", /Cloudflare D1（SQLite）/.test(pagesSrc) && /迁移脚本在仓库里/.test(pagesSrc));
  check("充值页如实写明没有真实支付通道", pagesSrc.includes("本站没有真实支付通道"));
}

console.log("\nE. 图与围栏");
{
  check("ART_HD 与 art_hd.txt 逐字节一致", ART_HD === baseArt, `js=${ART_HD.length} txt=${baseArt.length}`);
  check("基准图无连续反引号 ⇒ 围栏正好 3 个", !baseArt.includes("`") && FENCED.startsWith("```\n") && FENCED.endsWith("\n```"));
  const rows = baseArt.split("\n").length;
  check(`图 ${rows} 行（≥40）`, rows >= 40, `实际 ${rows}`);
  const width = Math.max(...baseArt.split("\n").map((l) => [...l].length));
  console.log(`  [i] 图：${baseArt.length} 字符 / ${rows} 行 / 最大宽 ${width} 列`);
}

console.log(`\n${fail === 0 ? "全部通过" : "有失败项"}：${pass} PASS / ${fail} FAIL`);
if (failures.length) {
  console.log("\n失败清单：");
  for (const f of failures) console.log("  - " + f);
}
process.exit(fail === 0 ? 0 : 1);
