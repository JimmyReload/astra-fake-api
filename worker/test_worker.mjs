// Worker 版的独立验收（纯 Node，不需要 wrangler、不需要连云）。
//
//   node test_worker.mjs
//
// 判据刻意自己算，不从 src/index.js import 任何常量：
//   * ART_HD 必须与 ../art_hd.txt 逐字节相同（抓「生成器漂移/手改生成物」）
//   * blocks / ascii 版的标记字符串在这里硬编码
//   * 流式拼接结果必须与同一包装盒的非流式内容逐字符相同
//   * 代码围栏长度、模型 id 清单、鉴权状态码全部在这里独立重算
// v1.1.0 起正文包在 Markdown 代码围栏里（防客户端按 Markdown 渲染时折行/吞空格），
// 所以「内容相等」的判据统一是 unwrap(...) === hdFile，而不是直接比对原始字符串。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "./src/index.js";
import { ART_HD, ART_BLOCKS, ART_ASCII } from "./src/art.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "https://astra-fake-api.example.com";

const BLOCK_MARK_A = "HA  HA  HA";
const BLOCK_MARK_B = "捧着肚子";
const HD_MIN_LINES = 60;

// 验收用自己的密钥与模型清单，不从源码 import（否则源码写错也跟着错）。
const TEST_KEY = "sk-astra-test-4f9c1e2b7a0d";
const TEST_KEY_NON_ASCII = "sk-é-nailong";
const ENV = { NAILONG_API_KEY: TEST_KEY };
const AUTH = { Authorization: `Bearer ${TEST_KEY}` };
const EXPECTED_MODEL_IDS = [
  "gpt-6-astra",
  "gpt-6-astra-pro",
  "gpt-6-astra-20260903",
  "gpt-6-astra-high",
  "gpt-6-luna",
];
const EXPECTED_DEFAULT_MODEL = "gpt-6-astra";

const results = [];
function check(name, ok, detail = "") {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `   [${detail}]` : ""}`);
}

async function call(path, { method = "GET", body, headers = {}, env = ENV, auth = true } = {}) {
  const init = {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? AUTH : {}), ...headers },
  };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request(BASE + path, init), env, {});
  return { res, text: await res.text() };
}

/** 解析 SSE 文本 -> { events: [名字], datas: [字符串] } */
function parseSse(text) {
  const events = [];
  const datas = [];
  for (const frame of text.split("\n\n")) {
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) events.push(line.slice(7).trim());
      else if (line.startsWith("data: ")) datas.push(line.slice(6));
    }
  }
  return { events, datas };
}

/** 不管外面套的是 JSON 外壳还是裸文本，把奶龙抠出来（带围栏，故这里不 unwrap）。 */
function extractArt(text) {
  try {
    const obj = JSON.parse(text);
    const inner = obj?.choices?.[0]?.message?.content;
    if (typeof inner === "string") return inner;
  } catch {
    /* 那就是裸图 */
  }
  return text;
}

/** 独立重算围栏：长度 = max(3, 最长连续反引号 + 1)。 */
function wrap(art) {
  const runs = art.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${art}\n${fence}`;
}

/** 剥掉最外层代码围栏；没围栏就原样返回（用于抓「忘了包围栏」）。 */
function unwrap(text) {
  const m = String(text).match(/^(`{3,})\n([\s\S]*)\n\1$/);
  return m ? m[2] : String(text);
}

function sseText(datas, kind) {
  const out = [];
  for (const raw of datas) {
    if (raw === "[DONE]") continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (kind === "chat") {
      for (const ch of obj.choices || []) {
        const piece = ch.delta?.content;
        if (piece) out.push(piece);
      }
    } else if (kind === "responses") {
      if (obj.type === "response.output_text.delta") out.push(obj.delta || "");
    } else if (kind === "anthropic") {
      if (obj.type === "content_block_delta") out.push(obj.delta?.text || "");
    }
  }
  return out.join("");
}

const hdFile = readFileSync(join(HERE, "..", "art_hd.txt"), "utf-8")
  .replace(/\r\n/g, "\n")
  .replace(/\r/g, "\n")
  .replace(/^\n+/, "")
  .replace(/\n+$/, "");
const hdWrapped = wrap(hdFile);

check(
  "art.js 的 ART_HD 与 art_hd.txt 逐字节相同",
  ART_HD === hdFile,
  `art.js ${ART_HD.length} 字符 vs 文件 ${hdFile.length} 字符`,
);
check(
  "HD 图够大（行数达标）",
  hdFile.split("\n").length >= HD_MIN_LINES && hdFile.length > 3000,
  `${hdFile.split("\n").length} 行 / ${hdFile.length} 字符`,
);
check(
  "blocks / ascii 两版标记齐全",
  ART_BLOCKS.includes(BLOCK_MARK_A) && ART_BLOCKS.includes(BLOCK_MARK_B) &&
    ART_ASCII.includes(BLOCK_MARK_A) && !ART_ASCII.includes("\u2584"),
  `blocks ${ART_BLOCKS.length} 字符 / ascii ${ART_ASCII.length} 字符`,
);
check(
  "围栏算出来是 3 个反引号（图里没有反引号）",
  wrap(hdFile).split("\n")[0] === "```" && !hdFile.includes("`"),
  `首行 ${JSON.stringify(wrap(hdFile).split("\n")[0])}`,
);

// 1. chat.completions 非流式
let { res, text } = await call("/v1/chat/completions", {
  method: "POST",
  body: { model: EXPECTED_DEFAULT_MODEL, messages: [{ role: "user", content: "你好" }] },
});
let body = JSON.parse(text);
check(
  "chat.completions 非流式原样回图",
  res.status === 200 && unwrap(body.choices[0].message.content) === hdFile &&
    body.object === "chat.completion",
  `外层 ${body.choices[0].message.content.length} 字符 / 剥围栏后 ${unwrap(body.choices[0].message.content).length}`,
);
check(
  "正文被 Markdown 代码围栏包住（首行/末行都是围栏）",
  body.choices[0].message.content.startsWith("```\n") &&
    body.choices[0].message.content.endsWith("\n```"),
  `首行 ${JSON.stringify(body.choices[0].message.content.split("\n")[0])}`,
);
check(
  "响应头正确（CORS + 奶龙标记）",
  res.headers.get("access-control-allow-origin") === "*" && res.headers.get("x-nailong") === "laughing",
  `X-Powered-By=${res.headers.get("x-powered-by")}`,
);

// 2. chat.completions 流式
({ text } = await call("/v1/chat/completions", {
  method: "POST",
  body: { model: EXPECTED_DEFAULT_MODEL, stream: true, messages: [{ role: "user", content: "讲个笑话" }] },
}));
let sse = parseSse(text);
check("chat 流式 [DONE] 唯一", sse.datas.filter((d) => d === "[DONE]").length === 1, `${sse.datas.length} 帧`);
check(
  "chat 流式拼接 == 非流式内容（均为围栏 + 图）",
  sseText(sse.datas, "chat") === hdWrapped,
  `stream ${sseText(sse.datas, "chat").length} 字符`,
);
check(
  "chat 流式逐行吐（帧数 >= 行数）",
  sse.datas.length >= hdWrapped.split("\n").length,
  `${sse.datas.length - 1} 内容帧`,
);

// 3. Responses API
({ res, text } = await call("/v1/responses", {
  method: "POST",
  body: { model: EXPECTED_DEFAULT_MODEL, input: "hi" },
}));
body = JSON.parse(text);
check(
  "responses 非流式原样回图",
  res.status === 200 && body.output_text === hdWrapped && body.object === "response" &&
    unwrap(body.output_text) === hdFile,
);

({ text } = await call("/v1/responses", {
  method: "POST",
  body: { model: EXPECTED_DEFAULT_MODEL, stream: true, input: "hi" },
}));
sse = parseSse(text);
check(
  "responses 流式事件齐全且拼接一致",
  sse.events.includes("response.created") && sse.events.includes("response.completed") &&
    sseText(sse.datas, "responses") === hdWrapped,
  `${sse.events.length} 个事件`,
);

// 4. Anthropic Messages
({ res, text } = await call("/v1/messages", {
  method: "POST",
  body: { model: "claude-3-5-sonnet", max_tokens: 1024, messages: [{ role: "user", content: "hi" }] },
}));
body = JSON.parse(text);
check(
  "anthropic 非流式原样回图且回显模型名",
  res.status === 200 && unwrap(body.content[0].text) === hdFile && body.model === "claude-3-5-sonnet",
  body.model,
);

({ text } = await call("/v1/messages", {
  method: "POST",
  body: { model: EXPECTED_DEFAULT_MODEL, stream: true, max_tokens: 1024, messages: [{ role: "user", content: "hi" }] },
}));
sse = parseSse(text);
check(
  "anthropic 流式事件齐全且拼接一致",
  sse.events.includes("message_start") && sse.events.includes("message_stop") &&
    sseText(sse.datas, "anthropic") === hdWrapped,
  `${sse.events.length} 个事件`,
);

// 5. count_tokens / models
({ res, text } = await call("/v1/messages/count_tokens", {
  method: "POST",
  body: { model: EXPECTED_DEFAULT_MODEL, messages: [{ role: "user", content: "一二三四五六七八" }] },
}));
check("count_tokens 假装数 token", res.status === 200 && JSON.parse(text).input_tokens >= 1, text);

({ res, text } = await call("/v1/models"));
const ids = JSON.parse(text).data.map((m) => m.id);
check(
  "/v1/models 的模型 id 与约定清单逐项相同",
  res.status === 200 && JSON.stringify(ids) === JSON.stringify(EXPECTED_MODEL_IDS),
  ids.join(","),
);

// 6. 任何别的调用也只会拿到图
for (const [label, path, init] of [
  ["未知 GET 路径", "/whatever/you/want?q=1", {}],
  ["DELETE 任何路径", "/admin/delete-everything", { method: "DELETE" }],
  ["PUT 任何路径", "/v1/credentials", { method: "PUT", body: "{}" }],
  ["OPTIONS 预检", "/v1/chat/completions", { method: "OPTIONS" }],
]) {
  const r = await call(path, init);
  // 已知路径上的 OPTIONS 走路由表，会套一层 JSON 外壳；未知路径则是裸图（text/plain，没有 Markdown 渲染，故不包围栏）。
  // 判据统一为「奶龙在响应里」，与 Python 版逐条对齐。
  check(`${label} 照回图`, r.res.status === 200 && unwrap(extractArt(r.text)) === hdFile, `${r.text.length} 字符`);
}

// 7. 畸形请求体不许 500
({ res, text } = await call("/v1/chat/completions", { method: "POST", body: { messages: "not-a-list" } }));
check("畸形 JSON 结构仍回图", res.status === 200 && unwrap(JSON.parse(text).choices[0].message.content) === hdFile);
({ res, text } = await call("/v1/chat/completions", { method: "POST", body: "{这不是 JSON" }));
check("非 JSON 请求体仍回图（不 500）", res.status === 200 && unwrap(JSON.parse(text).choices[0].message.content) === hdFile);

// 8. 三版可切
({ text } = await call("/v1/whatever?art=blocks"));
check("?art=blocks 切到手绘方块版", extractArt(text) === ART_BLOCKS && text !== hdFile, `${text.split("\n").length} 行`);
({ text } = await call("/v1/whatever?art=ascii"));
check("?art=ascii 切到纯 ASCII 版", extractArt(text) === ART_ASCII && !text.includes("\u2584"), `${text.split("\n").length} 行`);
({ text } = await call("/v1/chat/completions?stream=1"));
check("GET + ?stream=1 强制流式", text.includes("data: ") && text.includes("[DONE]"));

// 9. 回显模型名（GET 用查询参数）
({ text } = await call(`/v1/chat/completions?model=${EXPECTED_MODEL_IDS[1]}`));
check(
  "回显请求里的模型名",
  JSON.parse(text.split("\n\n")[0].replace(/^data: /, "")).model === EXPECTED_MODEL_IDS[1],
);

// 10. 鉴权：key 闸门
({ res, text } = await call("/v1/chat/completions", { method: "POST", auth: false, body: { model: EXPECTED_DEFAULT_MODEL } }));
let err = JSON.parse(text);
check(
  "不带 key -> 401 invalid_api_key（且带 WWW-Authenticate）",
  res.status === 401 && err.error?.code === "invalid_api_key" &&
    res.headers.get("www-authenticate") === 'Bearer realm="chatgpt-astra"' &&
    res.headers.get("access-control-allow-origin") === "*",
  `${res.status} code=${err.error?.code} www=${res.headers.get("www-authenticate")}`,
);
check(
  "401 错误体是 OpenAI 形状",
  err.error?.type === "invalid_request_error" && err.error?.param === null,
  JSON.stringify(err.error?.type),
);

({ res } = await call("/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer sk-wrong-key" }, body: { model: EXPECTED_DEFAULT_MODEL } }));
check("key 不对 -> 401", res.status === 401, `${res.status}`);

({ res } = await call("/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer sk-wrong-key" }, env: {} }));
check("服务端没配密钥 -> 401（fail-closed，不是放行）", res.status === 401, `${res.status}`);

({ res } = await call("/v1/chat/completions", { method: "POST", headers: { Authorization: TEST_KEY }, body: { model: EXPECTED_DEFAULT_MODEL } }));
check("Authorization 不带 Bearer 前缀也认", res.status === 200, `${res.status}`);

({ res } = await call("/v1/chat/completions", { method: "POST", auth: false, headers: { "x-api-key": TEST_KEY }, body: { model: EXPECTED_DEFAULT_MODEL } }));
check("x-api-key 头也认", res.status === 200, `${res.status}`);

({ res } = await call("/v1/chat/completions", {
  method: "POST",
  auth: false,
  env: { NAILONG_API_KEY: TEST_KEY_NON_ASCII },
  headers: { Authorization: `Bearer ${TEST_KEY_NON_ASCII}` },
  body: { model: EXPECTED_DEFAULT_MODEL },
}));
check("非 ASCII 密钥不炸（按 UTF-8 字节比）", res.status === 200, `${res.status}`);

({ res } = await call("/v1/chat/completions", { method: "OPTIONS", auth: false }));
check("OPTIONS 预检不校验 key", res.status === 200, `${res.status}`);

// 11. 鉴权：模型闸门
({ res, text } = await call("/v1/chat/completions", { method: "POST", body: { model: "gpt-9-nonexistent" } }));
err = JSON.parse(text);
check(
  "未知模型 -> 404 model_not_found",
  res.status === 404 && err.error?.code === "model_not_found" && err.error?.param === "model",
  `${res.status} code=${err.error?.code} param=${err.error?.param}`,
);

({ res } = await call("/v1/chat/completions", { method: "POST", body: { model: "gpt-4o" } }));
check("白名单里的老名字仍放行（gpt-4o）", res.status === 200, `${res.status}`);

({ res } = await call("/v1/chat/completions", {
  method: "POST",
  env: { NAILONG_API_KEY: TEST_KEY, ASTRA_STRICT_MODELS: "1" },
  body: { model: "gpt-4o" },
}));
check("ASTRA_STRICT_MODELS=1 时老名字被 404", res.status === 404, `${res.status}`);

const passed = results.filter(([, ok]) => ok).length;
console.log("-".repeat(60));
console.log(`合计 ${passed}/${results.length} 通过`);
if (passed !== results.length) {
  for (const [name, ok, detail] of results) if (!ok) console.log(`  x ${name}  ${detail}`);
  process.exit(1);
}
