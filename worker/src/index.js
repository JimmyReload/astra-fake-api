// ChatGPT-Astra 伪装 API —— Cloudflare Workers 版
// 任何调用都只会返回一张「奶龙捧腹大笑」的 ASCII 图。
// 与同仓库的 Python 版（server.py）行为逐条对齐，接口外形：
//   POST /v1/chat/completions  (OpenAI Chat Completions，stream:true 走 SSE)
//   POST /v1/responses         (OpenAI Responses API，含 output_text.delta 事件流)
//   POST /v1/messages          (Anthropic Messages，含 content_block_delta 事件流)
//   POST /v1/messages/count_tokens
//   GET  /v1/models
//   其它任何路径/方法           -> 200 + 同一张图（未知路径不 404；只有下面那两道闸门会挡：401 没 key / 404 模型不在白名单）
//
// 参数：?art=hd|blocks|ascii（默认 hd）、?stream=1
//
// 正文形态：JSON/SSE 包装盒里的正文一律是「代码围栏 + 图」（以一行 ``` 开头、以一行 ```
// 结尾）——客户端按 Markdown 渲染时裸 ASCII 图会被折行、连续空格被吞；非标路径那一条
// 回的是裸图（text/plain）。围栏长度按图里最长反引号串动态算，换图不用改代码。
import { ART_HD, ART_BLOCKS, ART_ASCII } from "./art.js";

const VERSION = "1.1.0";
// 这五个 id 是上游真实存在的（2026-10-07 回源核对，与 server.py 逐条一致）：
// gpt-6-astra 在 platform.openai.com/docs/models/gpt-6-astra 上 HTTP 200（标题 "GPT-6 Astra
// Model | OpenAI API"）；同族变体 -pro / -20260903 / -high 见 OpenRouter 的 gpt-6-astra 详情页。
// 伪造的首版 gpt-5.2-astra / o5-astra-lite 在同一文档页都是 404，已废弃 —— 中转站像不像，
// 首先看 id 对不对得上。
const DEFAULT_MODEL = "gpt-6-astra";
const MODELS = [
  { id: "gpt-6-astra", object: "model", owned_by: "openai", created: 1788393600 },
  { id: "gpt-6-astra-pro", object: "model", owned_by: "openai", created: 1788393600 },
  { id: "gpt-6-astra-20260903", object: "model", owned_by: "openai", created: 1788393600 },
  { id: "gpt-6-astra-high", object: "model", owned_by: "openai", created: 1788393600 },
  { id: "gpt-6-luna", object: "model", owned_by: "openai", created: 1790100786 },
];

const encoder = new TextEncoder();
const TRUE_WORDS = ["1", "true", "yes", "on"];

// ---------------------------------------------------------------- 鉴权
// 与 server.py 逐条对齐（2026-10-07 拍板：给 v1.0 的「任何调用都回奶龙、绝不 404」加两道闸）：
//   * 没有 key / key 不对 -> 401 invalid_api_key（带 WWW-Authenticate）
//   * model 不在白名单里  -> 404 model_not_found
//   * OPTIONS 例外：CORS 预检由浏览器自动发出、**不带 Authorization 头**，
//     预检也校验的话所有浏览器端调用会直接崩在预检上，故预检永远放行。
// 空 key = 拒绝一切（fail-closed，不是放行）——密钥由 `wrangler secret put NAILONG_API_KEY` 落地。
const KEY_ENV = "NAILONG_API_KEY";
// 白名单 = 5 个**与上游同名**的 Astra id + 几个「大家会顺手填的真名」。
// 给 env.ASTRA_STRICT_MODELS=1 就只认那 5 个（gpt-4o 之类会 404）。
const LEGACY_MODEL_ALIASES = ["gpt-4o", "gpt-4o-mini", "o1", "o3", "claude-3-5-sonnet"];
const ALLOWED_MODELS = new Set([...MODELS.map((m) => m.id), ...LEGACY_MODEL_ALIASES]);

function allowedModels(env) {
  const strict = String(env?.ASTRA_STRICT_MODELS ?? "").trim().toLowerCase();
  if (TRUE_WORDS.includes(strict)) return new Set(MODELS.map((m) => m.id));
  return ALLOWED_MODELS;
}

/** 定长比较，按 UTF-8 字节比（顺带避开 Python 侧 compare_digest 对非 ASCII str 抛 TypeError 的同类坑）。 */
function keyMatches(env, candidate) {
  const expected = String(env?.[KEY_ENV] ?? "");
  const given = String(candidate ?? "").trim();
  if (!expected || !given) return false;
  const a = encoder.encode(expected);
  const b = encoder.encode(given);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** 真客户端怎么带 key 都认：Authorization: Bearer xxx / Authorization: xxx / x-api-key: xxx。 */
function extractKey(headers) {
  const raw = (headers.get("authorization") || "").trim();
  if (raw) {
    const m = raw.match(/^(\S+)\s+(\S.*)$/);
    if (m && (m[1].toLowerCase() === "bearer" || m[1].toLowerCase() === "token")) return m[2].trim();
    return raw;
  }
  for (const name of ["x-api-key", "api-key", "x-auth-token"]) {
    const value = (headers.get(name) || "").trim();
    if (value) return value;
  }
  return "";
}

/** OpenAI 风格的错误体（各家 SDK 都认这个形状）。 */
function errorBody(message, code, param = null) {
  return { error: { message, type: "invalid_request_error", param, code } };
}

function authError() {
  return errorBody(
    "Incorrect API key provided. You can find your API key at " +
      "https://platform.openai.com/account/api-keys.",
    "invalid_api_key",
  );
}

function modelError(model) {
  return errorBody(
    `The model '${model}' does not exist or you do not have access to it.`,
    "model_not_found",
    "model",
  );
}

// ---------------------------------------------------------------- 小工具

function hex(length = 24) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

const rid = (prefix) => `${prefix}_${hex(24)}`;
const nowSec = () => Math.floor(Date.now() / 1000);
const artTokens = (text) => Math.max(1, Math.floor(text.length / 4));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 按行切块（等价于 Python 的 splitlines(keepends=True)）。 */
function chunkLines(text) {
  const parts = text.split(/(?<=\n)/);
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function pickArt(url, env) {
  const wanted = (url.searchParams.get("art") || env?.ASTRA_ART || "hd").toLowerCase();
  if (wanted.startsWith("blocks")) return ART_BLOCKS;
  if (wanted.startsWith("ascii")) return ART_ASCII;
  return ART_HD || ART_BLOCKS;
}

/**
 * 围栏长度按图里最长的连续反引号算（默认 3）——换图不需要改代码。
 * 裸 ASCII 图直接塞进 Markdown 会被折行、连续空格被吞，所以正文必须包代码块。
 */
function fenceFor(art) {
  const runs = art.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function asMarkdownBlock(art) {
  const fence = fenceFor(art);
  return `${fence}\n${art}\n${fence}`;
}

const BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "X-Powered-By": "nailong-laughing-engine",
  "X-Nailong": "laughing",
  "Cache-Control": "no-store",
};

function jsonResponse(obj, extra = {}, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function textResponse(text, extra = {}) {
  return new Response(text, {
    status: 200,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra },
  });
}

function sseResponse(frames, extra = {}) {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const frame of frames()) controller.enqueue(encoder.encode(frame));
      } catch (err) {
        console.error("stream aborted:", err);
      } finally {
        try {
          controller.close();
        } catch {
          /* 已经关了 */
        }
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      ...extra,
    },
  });
}

// ---------------------------------------------------------------- 各种包装盒

function chatCompletionBody(model, art, promptTokens) {
  return {
    id: rid("chatcmpl"),
    object: "chat.completion",
    created: nowSec(),
    model,
    system_fingerprint: "fp_nailong_2026",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: art, refusal: null, annotations: [] },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: artTokens(art),
      total_tokens: promptTokens + artTokens(art),
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function responsesBody(model, art, promptTokens) {
  return {
    id: rid("resp"),
    object: "response",
    created_at: nowSec(),
    status: "completed",
    model,
    output: [
      {
        id: rid("msg"),
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: art, annotations: [] }],
      },
    ],
    output_text: art,
    parallel_tool_calls: true,
    tools: [],
    usage: {
      input_tokens: promptTokens,
      output_tokens: artTokens(art),
      total_tokens: promptTokens + artTokens(art),
    },
  };
}

function anthropicBody(model, art, promptTokens) {
  return {
    id: rid("msg"),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: art }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: promptTokens, output_tokens: artTokens(art) },
  };
}

async function* sseChat(model, art, promptTokens) {
  const id = rid("chatcmpl");
  const created = nowSec();
  const frame = (delta, finish = null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
    })}\n\n`;

  yield frame({ role: "assistant", content: "" });
  for (const piece of chunkLines(art)) {
    yield frame({ content: piece });
    await sleep(2);
  }
  yield frame({}, "stop");
  yield `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: artTokens(art),
      total_tokens: promptTokens + artTokens(art),
    },
  })}\n\n`;
  yield "data: [DONE]\n\n";
}

async function* sseResponses(model, art, promptTokens) {
  const body = responsesBody(model, art, promptTokens);
  const item = body.output[0];
  const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const inProgress = { ...body, status: "in_progress", output: [] };

  yield ev("response.created", { type: "response.created", response: inProgress });
  yield ev("response.in_progress", { type: "response.in_progress", response: inProgress });
  yield ev("response.output_item.added", {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...item, status: "in_progress", content: [] },
  });
  yield ev("response.content_part.added", {
    type: "response.content_part.added",
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
  for (const piece of chunkLines(art)) {
    yield ev("response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: piece,
    });
    await sleep(2);
  }
  yield ev("response.output_text.done", {
    type: "response.output_text.done",
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    text: art,
  });
  yield ev("response.content_part.done", {
    type: "response.content_part.done",
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: art, annotations: [] },
  });
  yield ev("response.output_item.done", { type: "response.output_item.done", output_index: 0, item });
  yield ev("response.completed", { type: "response.completed", response: body });
}

async function* sseAnthropic(model, art, promptTokens) {
  const id = rid("msg");
  const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

  yield ev("message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: promptTokens, output_tokens: 0 },
    },
  });
  yield ev("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  yield ev("ping", { type: "ping" });
  for (const piece of chunkLines(art)) {
    yield ev("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: piece },
    });
    await sleep(2);
  }
  yield ev("content_block_stop", { type: "content_block_stop", index: 0 });
  yield ev("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: artTokens(art) },
  });
  yield ev("message_stop", { type: "message_stop" });
}

// ---------------------------------------------------------------- 路由

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    let raw = "";
    if (request.method !== "GET" && request.method !== "HEAD") {
      try {
        raw = await request.text();
      } catch {
        raw = "";
      }
    }
    let data = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
      } catch {
        data = {};
      }
    }

    const model = String(data.model || url.searchParams.get("model") || DEFAULT_MODEL);
    const rawArt = pickArt(url, env);
    // 所有 JSON/SSE 包装盒里的正文 = 代码围栏 + 图（避免客户端按 Markdown 渲染时折行、吞空格）；
    // 裸图只留给非标路径那一条（text/plain，没有 Markdown 渲染）。
    const art = asMarkdownBlock(rawArt);
    const stream =
      Boolean(data.stream) || TRUE_WORDS.includes((url.searchParams.get("stream") || "").toLowerCase());
    const promptTokens = Math.max(1, Math.floor(raw.length / 4));
    const note = (text) =>
      console.log(`${request.method} ${path} ${stream ? "SSE " : "JSON"} model=${model} -> ${text}`);

    // ---- 鉴权闸门（CORS 预检除外，理由见上面 KEY_ENV 那段）----------------
    if (request.method !== "OPTIONS") {
      if (!keyMatches(env, extractKey(request.headers))) {
        note("401 没有对得上的 API key");
        return jsonResponse(authError(), { "WWW-Authenticate": 'Bearer realm="chatgpt-astra"' }, 401);
      }
      if (!allowedModels(env).has(model)) {
        note("404 模型不在白名单里");
        return jsonResponse(modelError(model), {}, 404);
      }
    }

    if (path === "/v1/models" || path === "/models") {
      note(`卖出 ${MODELS.length} 个模型（id 与上游一致）`);
      return jsonResponse({ object: "list", data: MODELS });
    }

    if (path === "/v1/chat/completions" || path === "/chat/completions") {
      if (stream) {
        note("奶龙开始一帧一帧地笑（chat.completion.chunk）");
        return sseResponse(() => sseChat(model, art, promptTokens), { "X-Stream-Mode": "chat.completions" });
      }
      note("奶龙就位（chat.completion）");
      return jsonResponse(chatCompletionBody(model, art, promptTokens));
    }

    if (path === "/v1/responses" || path === "/responses") {
      if (stream) {
        note("奶龙开始一帧一帧地笑（response.output_text.delta）");
        return sseResponse(() => sseResponses(model, art, promptTokens), { "X-Stream-Mode": "responses" });
      }
      note("奶龙就位（response.output_text）");
      return jsonResponse(responsesBody(model, art, promptTokens));
    }

    if (path === "/v1/messages" || path === "/messages") {
      if (stream) {
        note("奶龙开始一帧一帧地笑（content_block_delta）");
        return sseResponse(() => sseAnthropic(model, art, promptTokens), {
          "X-Stream-Mode": "anthropic.messages",
        });
      }
      note("奶龙就位（anthropic message）");
      return jsonResponse(anthropicBody(model, art, promptTokens));
    }

    if (path === "/v1/messages/count_tokens") {
      note("数了数奶龙的像素当 token");
      return jsonResponse({ input_tokens: promptTokens });
    }

    note("非标路径 → 照旧奶龙");
    return textResponse(rawArt, { "X-Fake-Version": VERSION });
  },
};
