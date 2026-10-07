// 假中转站的**线上**验收：对真实 URL 打全套路由，逐字节比对基准图。
// 运行：node relay/verify_live.mjs https://api.caar.fun
//
// 为什么用 Node 而不是 Python：本机 zone（caar.fun）开了 Browser Integrity Check，
// python-urllib 的默认 UA 会被边缘回 403 / error code 1010，而 Node 内置 fetch(undici)
// 的 UA 是 `node`，实测两个入口都放行 —— 这也正是 DSH 的 LLM 栈发出的签名。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || "https://api.caar.fun").replace(/\/+$/, "");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  [√] ${name}`); }
  else { fail++; failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  [x] ${name}${detail ? " — " + detail : ""}`); }
}

const baseArt = readFileSync(join(HERE, "..", "art_hd.txt"), "utf8")
  .replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
const FENCED = "```\n" + baseArt + "\n```";
console.log(`目标：${BASE}`);
console.log(`基准：art_hd.txt 去尾换行 = ${baseArt.length} 字符 / ${baseArt.split("\n").length} 行\n`);

const GET = (p, init) => fetch(BASE + p, init);
const POST = (p, body) =>
  fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

console.log("A. 页面与头");
{
  for (const [p, needle] of [["/", "整活站"], ["/login", "不会发送任何网络请求"], ["/panel", "概览"],
    ["/models", "模型广场"], ["/tokens", "令牌管理"], ["/usage", "调用日志"], ["/recharge", "本站不收钱"],
    ["/settings", "设置"], ["/docs", "接口文档"], ["/about", "整活站"]]) {
    const r = await GET(p);
    const b = await r.text();
    check(`GET ${p} → 200 + 免责声明 + 「${needle}」`,
      r.status === 200 && (r.headers.get("content-type") || "").includes("text/html") && b.includes(needle) && b.includes("本站是整活站，不是真中转站"),
      `status=${r.status} ct=${r.headers.get("content-type")} len=${b.length}`);
  }
  const r = await GET("/v1/models");
  check("响应头 X-Relay-Note 在位（对外声明整活）", (r.headers.get("x-relay-note") || "").includes("fake-relay"), r.headers.get("x-relay-note") || "(无)");
  check("响应头 X-Nailong: laughing", r.headers.get("x-nailong") === "laughing");
  check("CORS 允许任意来源", r.headers.get("access-control-allow-origin") === "*");
}

console.log("\nB. /v1 两套协议（逐字节比对）");
{
  const m = await (await GET("/v1/models")).json();
  check("GET /v1/models → 8 个模型", m.object === "list" && m.data.length === 8, `n=${m.data?.length}`);
  check("模型 id 含 gpt-6-astra", m.data.some((x) => x.id === "gpt-6-astra"));

  const chat = await (await POST("/v1/chat/completions", { model: "gpt-6-astra", messages: [{ role: "user", content: "你好" }] })).json();
  check("非流式正文 = 围栏 + 基准图（逐字节）", chat.choices?.[0]?.message?.content === FENCED,
    `len=${chat.choices?.[0]?.message?.content?.length} vs ${FENCED.length}`);
  check("object=chat.completion / finish_reason=stop",
    chat.object === "chat.completion" && chat.choices[0].finish_reason === "stop");

  const sres = await POST("/v1/chat/completions", { model: "gpt-6-astra", stream: true });
  const sbody = await sres.text();
  const done = (sbody.match(/^data: \[DONE\]$/gm) || []).length;
  let acc = "", usage = 0, contentFrames = 0;
  for (const f of sbody.split("\n\n")) {
    if (!f.startsWith("data: ") || f.includes("[DONE]")) continue;
    const o = JSON.parse(f.slice(6));
    if (!o.choices || o.choices.length === 0) { usage++; continue; }
    const c = o.choices[0]?.delta?.content;
    if (typeof c === "string" && c.length) { acc += c; contentFrames++; }
  }
  check("流式 Content-Type = text/event-stream", (sres.headers.get("content-type") || "").includes("text/event-stream"));
  check("流式恰好一个 [DONE]", done === 1, `实际 ${done}`);
  check("流式拼接 = 围栏 + 基准图（逐字节）", acc === FENCED, `len=${acc.length} vs ${FENCED.length}`);
  check("流式恰好一个 usage 收尾帧", usage === 1, `实际 ${usage}`);
  console.log(`  [i] 流式：${contentFrames} 个内容帧 + ${usage} 个 usage 帧`);

  const resp = await (await POST("/v1/responses", { model: "gpt-6-luna", input: "hi" })).json();
  check("POST /v1/responses → output_text = 围栏图", resp.object === "response" && resp.output_text === FENCED);

  const msg = await (await POST("/v1/messages", { model: "gpt-6-astra", messages: [] })).json();
  check("POST /v1/messages → content[0].text = 围栏图", msg.type === "message" && msg.content?.[0]?.text === FENCED);

  const ct = await (await POST("/v1/messages/count_tokens", { model: "gpt-6-astra" })).json();
  check("POST /v1/messages/count_tokens → input_tokens>0", typeof ct.input_tokens === "number" && ct.input_tokens > 0, JSON.stringify(ct));
}

console.log("\nC. 假面板 + 兜底路由");
{
  for (const p of ["/api/status", "/api/models", "/api/pricing", "/api/user/self", "/api/token/", "/api/log/self"]) {
    const j = await (await GET(p)).json();
    check(`GET ${p} → success=true`, j.success === true, JSON.stringify(j).slice(0, 100));
  }
  const st = await (await GET("/api/status")).json();
  check("/api/status 自带「这是整活站」免责声明", (st.data?.disclaimer || "").includes("奶龙"));
  check("GET /robots.txt → Disallow: /", (await (await GET("/robots.txt")).text()).includes("Disallow: /"));
  const opt = await GET("/v1/chat/completions", { method: "OPTIONS" });
  check("OPTIONS → 204", opt.status === 204, `status=${opt.status}`);
  for (const p of ["/完全不存在", "/v1/不存在", "/favicon.ico", "/a/b/c"]) {
    const r = await GET(p);
    const b = await r.text();
    check(`GET ${p} → 200 + 裸图（不 404）`, r.status === 200 && b === baseArt, `status=${r.status} len=${b.length}`);
  }
}

console.log(`\n${fail === 0 ? "全部通过" : "有失败项"}：${pass} PASS / ${fail} FAIL`);
if (failures.length) { console.log("\n失败清单："); for (const f of failures) console.log("  - " + f); }
process.exit(fail === 0 ? 0 : 1);
