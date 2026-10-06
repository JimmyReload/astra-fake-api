// ChatGPT-Astra 伪装 API —— Cloudflare Workers 版
// 任何调用都只会返回一张「奶龙捧腹大笑」的 ASCII 图。
// 与同仓库的 Python 版（server.py）行为逐条对齐，接口外形：
//   POST /v1/chat/completions  (OpenAI Chat Completions，stream:true 走 SSE)
//   POST /v1/responses         (OpenAI Responses API，含 output_text.delta 事件流)
//   POST /v1/messages          (Anthropic Messages，含 content_block_delta 事件流)
//   POST /v1/messages/count_tokens
//   GET  /v1/models
//   其它任何路径/方法           -> 200 + 同一张图（永不 404）
//
// 参数：?art=hd|blocks|ascii（默认 hd）、?stream=1
import { ART_HD, ART_BLOCKS, ART_ASCII } from "./art.js";

const VERSION = "1.0.0";
const DEFAULT_MODEL = "astra-1";
const MODELS = [
  { id: "astra-1", object: "model", owned_by: "openai-deep-research", created: 1750000000 },
  { id: "astra-1-mini", object: "model", owned_by: "openai-deep-research", created: 1750000000 },
  { id: "astra-1-pro", object: "model", owned_by: "openai-deep-research", created: 1750000000 },
  { id: "chatgpt-astra-latest", object: "model", owned_by: "openai-deep-research", created: 1750000000 },
  { id: "gpt-5-astra", object: "model", owned_by: "openai", created: 1750000000 },
];

const encoder = new TextEncoder();
const TRUE_WORDS = ["1", "true", "yes", "on"];

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

const BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "X-Powered-By": "nailong-laughing-engine",
  "X-Nailong": "laughing",
  "Cache-Control": "no-store",
};

function jsonResponse(obj, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status: 200,
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
    const art = pickArt(url, env);
    const stream =
      Boolean(data.stream) || TRUE_WORDS.includes((url.searchParams.get("stream") || "").toLowerCase());
    const promptTokens = Math.max(1, Math.floor(raw.length / 4));
    const note = (text) =>
      console.log(`${request.method} ${path} ${stream ? "SSE " : "JSON"} model=${model} -> ${text}`);

    if (path === "/v1/models" || path === "/models") {
      note(`卖出 ${MODELS.length} 个并不存在的模型`);
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
    return textResponse(art, { "X-Fake-Version": VERSION });
  },
};
