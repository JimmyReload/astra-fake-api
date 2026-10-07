// 假中转站的本地验收：直接 import Worker 模块，用 Request/Response 打全套路由。
// 运行：node relay/test_relay.mjs
//
// 除功能外，这里还刻意加了「不收集数据」的**静态自检**（见 D 组）——
// 那几条不是形式主义：登录页写明了"一个字节都不发出去"，那就必须能被机器验出来。
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
const get = async (path, init) => worker.fetch(req(path, init));

const post = (path, body) =>
  worker.fetch(req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

// 基准图（去尾换行），用于逐字节比对
const baseArt = readFileSync(join(ROOT, "art_hd.txt"), "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
const FENCED = "```\n" + baseArt + "\n```";

console.log("A. 页面");
{
  const pages = [
    ["/", "整活站"],
    ["/login", "不会发送任何网络请求"],
    ["/panel", "概览"],
    ["/models", "模型广场"],
    ["/tokens", "令牌管理"],
    ["/usage", "调用日志"],
    ["/recharge", "本站不收钱"],
    ["/settings", "设置"],
    ["/docs", "接口文档"],
    ["/about", "整活站"],
  ];
  for (const [path, needle] of pages) {
    const res = await get(path);
    const body = await res.text();
    check(
      `GET ${path} → 200 text/html 且含「${needle}」`,
      res.status === 200 && (res.headers.get("Content-Type") || "").includes("text/html") && body.includes(needle),
      `status=${res.status} ct=${res.headers.get("Content-Type")} len=${body.length}`,
    );
    check(`GET ${path} 带免责声明`, body.includes("本站是整活站，不是真中转站") && body.includes("不收集"), "页脚声明缺失");
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

console.log("\nC. /api 假面板 + 兜底路由");
{
  for (const p of ["/api/status", "/api/models", "/api/pricing", "/api/user/self", "/api/token/", "/api/log/self"]) {
    const res = await get(p);
    const j = await res.json();
    check(`GET ${p} → success=true`, res.status === 200 && j.success === true, JSON.stringify(j).slice(0, 120));
  }
  const st = await (await get("/api/status")).json();
  check("/api/status 自带免责声明", typeof st.data.disclaimer === "string" && st.data.disclaimer.includes("奶龙"));
  const nope = await (await get("/api/whatever")).json();
  check("未知 /api 路径 → success=false 且提示是整活站", nope.success === false && nope.message.includes("整活站"));

  const rb = await get("/robots.txt");
  check("GET /robots.txt → Disallow", (await rb.text()).includes("Disallow: /"));

  const opt = await worker.fetch(req("/v1/chat/completions", { method: "OPTIONS" }));
  check("OPTIONS → 204 + CORS", opt.status === 204 && opt.headers.get("Access-Control-Allow-Origin") === "*");

  for (const p of ["/完全不存在", "/v1/不存在", "/favicon.ico", "/a/b/c"]) {
    const res = await get(p);
    const body = await res.text();
    check(`GET ${p} → 200 + 裸图（不 404）`, res.status === 200 && body === baseArt, `status=${res.status} len=${body.length}`);
  }
}

console.log("\nD. 「不收集数据」静态自检（这几条是页面上那句承诺的机器判据）");
{
  const pagesSrc = readFileSync(join(HERE, "src", "pages.js"), "utf8");
  const indexSrc = readFileSync(join(HERE, "src", "index.js"), "utf8");
  const nailongSrc = readFileSync(join(HERE, "src", "nailong.js"), "utf8");
  const allSrc = pagesSrc + indexSrc + nailongSrc;

  check("页面里没有任何 fetch( / XMLHttpRequest / sendBeacon", !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(pagesSrc));
  check("登录表单没有 action=（不会把表单提交出去）", !/action\s*=/.test(pagesSrc));
  check("登录页明确写出「不发任何网络请求」", pagesSrc.includes("不会发送任何网络请求"));
  check("登录页提醒不要填真实密码", pagesSrc.includes("请不要输入任何真实密码"));
  check("充值页二维码盖着「本站不收钱」水印", pagesSrc.includes("本站不收钱") && pagesSrc.includes("class=\"stamp\""));
  check("充值页明写「请不要付款」", pagesSrc.includes("请不要付款"));
  // 只认真正的调用形态 console.xxx( —— 注释里出现这个词不算违规
  check("全站没有任何 console 调用（请求体不该出现在日志里）", !/console\.(log|info|debug|warn|error)\s*\(/.test(allSrc));
  // 只认**资源加载**（script/img/link/@import/url()）。<a href> 是普通导航，不算。
  // 唯一允许的外链是 /about 里指向源码仓库的那个 <a>。
  const externalResources = pagesSrc.match(/(?:src|srcset)\s*=\s*["']https?:\/\/|<link[^>]*href\s*=\s*["']https?:\/\/|@import\s+url\(|url\(\s*["']?https?:\/\//g) || [];
  check("不加载任何第三方资源（脚本/图片/字体/样式）", externalResources.length === 0, externalResources.join(", "));
  check("响应头带 X-Relay-Note（对外声明这是整活站）", nailongSrc.includes("X-Relay-Note"));
  check("index.js 里没有把请求体写进任何存储的调用", !/localStorage|sessionStorage/.test(indexSrc));
  check("页脚免责声明出现在 layout 里（每页都有）", pagesSrc.includes("const FOOTER") && pagesSrc.includes("本站是整活站"));
  check("关于页写明不收集 / 不收钱 / 不接上游", pagesSrc.includes("不收集任何东西") && pagesSrc.includes("不收任何钱") && pagesSrc.includes("不接任何真实上游"));
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
