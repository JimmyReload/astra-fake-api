// Worker 版的独立验收（纯 Node，不需要 wrangler、不需要连云）。
//
//   node test_worker.mjs
//
// 判据刻意自己算，不从 src/index.js import 任何常量：
//   * ART_HD 必须与 ../art_hd.txt 逐字节相同（抓「生成器漂移/手改生成物」）
//   * blocks / ascii 版的标记字符串在这里硬编码
//   * 流式拼接结果必须与同一包装盒的非流式内容逐字符相同
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "./src/index.js";
import { ART_HD, ART_BLOCKS, ART_ASCII } from "./src/art.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const BLOCK_MARK_A = "HA  HA  HA";
const BLOCK_MARK_B = "捧着肚子";
const HD_MIN_LINES = 60;

const results = [];
function check(name, ok, detail = "") {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `   [${detail}]` : ""}`);
}

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const init = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request("https://astra-fake-api.example.com" + path, init), {}, {});
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

/** 不管外面套的是 JSON 外壳还是裸文本，把奶龙抠出来。 */
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

// 1. chat.completions 非流式
let { res, text } = await call("/v1/chat/completions", {
  method: "POST",
  body: { model: "astra-1", messages: [{ role: "user", content: "你好" }] },
});
let body = JSON.parse(text);
check(
  "chat.completions 非流式原样回图",
  res.status === 200 && body.choices[0].message.content === hdFile && body.object === "chat.completion",
  `${body.choices[0].message.content.length} 字符`,
);
check(
  "响应头正确（CORS + 奶龙标记）",
  res.headers.get("access-control-allow-origin") === "*" && res.headers.get("x-nailong") === "laughing",
  `X-Powered-By=${res.headers.get("x-powered-by")}`,
);

// 2. chat.completions 流式
({ text } = await call("/v1/chat/completions", {
  method: "POST",
  body: { model: "astra-1", stream: true, messages: [{ role: "user", content: "讲个笑话" }] },
}));
let sse = parseSse(text);
check("chat 流式 [DONE] 唯一", sse.datas.filter((d) => d === "[DONE]").length === 1, `${sse.datas.length} 帧`);
check(
  "chat 流式拼接 == 非流式内容",
  sseText(sse.datas, "chat") === hdFile,
  `stream ${sseText(sse.datas, "chat").length} 字符`,
);
check("chat 流式逐行吐（帧数 >= 行数）", sse.datas.length >= hdFile.split("\n").length, `${sse.datas.length - 1} 内容帧`);

// 3. Responses API
({ res, text } = await call("/v1/responses", { method: "POST", body: { model: "astra-1", input: "hi" } }));
body = JSON.parse(text);
check("responses 非流式原样回图", res.status === 200 && body.output_text === hdFile && body.object === "response");

({ text } = await call("/v1/responses", { method: "POST", body: { model: "astra-1", stream: true, input: "hi" } }));
sse = parseSse(text);
check(
  "responses 流式事件齐全且拼接一致",
  sse.events.includes("response.created") && sse.events.includes("response.completed") &&
    sseText(sse.datas, "responses") === hdFile,
  `${sse.events.length} 个事件`,
);

// 4. Anthropic Messages
({ res, text } = await call("/v1/messages", {
  method: "POST",
  body: { model: "claude-3-5-astra", max_tokens: 1024, messages: [{ role: "user", content: "hi" }] },
}));
body = JSON.parse(text);
check(
  "anthropic 非流式原样回图且回显模型名",
  res.status === 200 && body.content[0].text === hdFile && body.model === "claude-3-5-astra",
  body.model,
);

({ text } = await call("/v1/messages", {
  method: "POST",
  body: { model: "astra-1", stream: true, max_tokens: 1024, messages: [{ role: "user", content: "hi" }] },
}));
sse = parseSse(text);
check(
  "anthropic 流式事件齐全且拼接一致",
  sse.events.includes("message_start") && sse.events.includes("message_stop") &&
    sseText(sse.datas, "anthropic") === hdFile,
  `${sse.events.length} 个事件`,
);

// 5. count_tokens / models
({ res, text } = await call("/v1/messages/count_tokens", {
  method: "POST",
  body: { model: "astra-1", messages: [{ role: "user", content: "一二三四五六七八" }] },
}));
check("count_tokens 假装数 token", res.status === 200 && JSON.parse(text).input_tokens >= 1, text);

({ res, text } = await call("/v1/models"));
const ids = JSON.parse(text).data.map((m) => m.id);
check(
  "/v1/models 里都是 Astra",
  res.status === 200 && ids.length === 5 && ids.every((i) => i.includes("astra")),
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
  // 已知路径上的 OPTIONS 走路由表，会套一层 JSON 外壳；未知路径则是裸图。
  // 判据统一为「奶龙在响应里」，与 Python 版逐条对齐。
  check(`${label} 照回图`, r.res.status === 200 && extractArt(r.text) === hdFile, `${r.text.length} 字符`);
}

// 7. 畸形请求体不许 500
({ res, text } = await call("/v1/chat/completions", { method: "POST", body: { messages: "not-a-list" } }));
check("畸形 JSON 结构仍回图", res.status === 200 && JSON.parse(text).choices[0].message.content === hdFile);
({ res, text } = await call("/v1/chat/completions", { method: "POST", body: "{这不是 JSON" }));
check("非 JSON 请求体仍回图（不 500）", res.status === 200 && JSON.parse(text).choices[0].message.content === hdFile);

// 8. 三版可切
({ text } = await call("/v1/whatever?art=blocks"));
check("?art=blocks 切到手绘方块版", text === ART_BLOCKS && text !== hdFile, `${text.split("\n").length} 行`);
({ text } = await call("/v1/whatever?art=ascii"));
check("?art=ascii 切到纯 ASCII 版", text === ART_ASCII && !text.includes("\u2584"), `${text.split("\n").length} 行`);
({ text } = await call("/v1/chat/completions?stream=1"));
check("GET + ?stream=1 强制流式", text.includes("data: ") && text.includes("[DONE]"));

// 9. 回显模型名（GET 用查询参数）
({ text } = await call("/v1/chat/completions?model=astra-1-mini"));
check("回显请求里的模型名", JSON.parse(text.split("\n\n")[0].replace(/^data: /, "")).model === "astra-1-mini");

const passed = results.filter(([, ok]) => ok).length;
console.log("-".repeat(60));
console.log(`合计 ${passed}/${results.length} 通过`);
if (passed !== results.length) {
  for (const [name, ok, detail] of results) if (!ok) console.log(`  x ${name}  ${detail}`);
  process.exit(1);
}
