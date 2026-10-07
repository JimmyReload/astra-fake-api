// 「任何调用都回奶龙」的这半边。
//
// 刻意与 ../worker/src/index.js 里的同名逻辑保持一致（语义逐条对齐），但**不共用文件** ——
// 两个 Worker 要能各自独立部署，一个的改动不该把另一个带上线。
// 漂移由 relay/test_relay.mjs 与 worker/test_worker.mjs 两侧的同名判据兜住。
import { ART_HD, ART_BLOCKS, ART_ASCII } from "./art.js";

export const ARTS = { hd: ART_HD, blocks: ART_BLOCKS, ascii: ART_ASCII };

/** 按 ?art=hd|blocks|ascii 选一版图；不认的值一律回落 hd。 */
export function pickArt(value) {
  const key = String(value ?? "").toLowerCase();
  return ARTS[key] ?? ARTS.hd;
}

/** 围栏长度 = 图里最长连续反引号串 + 1（下限 3）。换图无需改代码。 */
export function fenceFor(text) {
  let longest = 0;
  for (const run of String(text).match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/** 把图包进 Markdown 代码围栏 —— 客户端按 Markdown 渲染时才不会把空格吃掉、把长行折了。 */
export function asMarkdownBlock(text) {
  const fence = fenceFor(text);
  return `${fence}\n${text}\n${fence}`;
}

/** 粗略 token 估算，纯粹为了 usage 字段好看（对中文偏低，但这里只是装饰）。 */
export const artTokens = (text) => Math.max(1, Math.floor(String(text).length / 4));

/** 按行切块，用来逐行吐 SSE。 */
export function chunkLines(text) {
  return String(text).match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE, PATCH, HEAD",
};

/** 所有响应共用的一套头。 */
export function headers(extra = {}) {
  return {
    ...CORS,
    "X-Powered-By": "nailong-laughing-engine",
    "X-Nailong": "laughing",
    "X-Relay-Note": "fake-relay; every call returns a nailong; no key required",
    "Cache-Control": "no-store",
    ...extra,
  };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: headers({ "Content-Type": "application/json; charset=utf-8" }) });

export const textResponse = (body, status = 200) =>
  new Response(body, { status, headers: headers({ "Content-Type": "text/plain; charset=utf-8" }) });

export const htmlResponse = (body, status = 200) =>
  new Response(body, { status, headers: headers({ "Content-Type": "text/html; charset=utf-8" }) });

const now = () => Math.floor(Date.now() / 1000);
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 12)}`;

/** OpenAI 形状的 chat.completion（正文是围栏 + 图）。 */
export function chatCompletion({ model, art, stream }) {
  const body = asMarkdownBlock(art);
  if (stream) return sse(body, model);
  return json({
    id: uid("chatcmpl"),
    object: "chat.completion",
    created: now(),
    model,
    system_fingerprint: "fp_nailong_laughing",
    choices: [{ index: 0, message: { role: "assistant", content: body }, logprobs: null, finish_reason: "stop" }],
    usage: { prompt_tokens: 9, completion_tokens: artTokens(body), total_tokens: 9 + artTokens(body) },
  });
}

/** OpenAI 形状的 SSE：逐行吐图，最后恰好一个 data: [DONE]。 */
function sse(body, model) {
  const id = uid("chatcmpl");
  const created = now();
  const frames = [];
  const frame = (delta, finish = null) =>
    `data: ${JSON.stringify({
      id, object: "chat.completion.chunk", created, model,
      system_fingerprint: "fp_nailong_laughing",
      choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
    })}\n\n`;

  frames.push(frame({ role: "assistant", content: "" }));
  for (const line of chunkLines(body)) frames.push(frame({ content: line }));
  frames.push(frame({}, "stop"));
  frames.push(
    `data: ${JSON.stringify({
      id, object: "chat.completion.chunk", created, model,
      choices: [],
      usage: { prompt_tokens: 9, completion_tokens: artTokens(body), total_tokens: 9 + artTokens(body) },
    })}\n\n`,
  );
  frames.push("data: [DONE]\n\n");

  return new Response(frames.join(""), {
    status: 200,
    headers: headers({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" }),
  });
}

/** OpenAI Responses 形状。 */
export function responsesApi({ model, art }) {
  const body = asMarkdownBlock(art);
  return json({
    id: uid("resp"),
    object: "response",
    created_at: now(),
    status: "completed",
    model,
    output: [
      {
        id: uid("msg"),
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: body, annotations: [] }],
      },
    ],
    output_text: body,
    usage: { input_tokens: 9, output_tokens: artTokens(body), total_tokens: 9 + artTokens(body) },
  });
}

/** Anthropic Messages 形状。 */
export function anthropicMessage({ model, art }) {
  const body = asMarkdownBlock(art);
  return json({
    id: uid("msg"),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: body }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 9, output_tokens: artTokens(body) },
  });
}

/** Anthropic count_tokens 形状（数的是图，不是你的问题）。 */
export function countTokens({ model, art }) {
  const n = artTokens(asMarkdownBlock(art));
  return json({ input_tokens: n, output_tokens: n, model });
}

/** /v1/models —— 与面板「模型广场」用的是同一份清单。 */
export function modelList(models) {
  return json({
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: 1759800000,
      owned_by: m.vendor,
      // 多塞几个字段，让「中转站」看起来更像那么回事
      permission: [],
      root: m.id,
      parent: null,
      context_window: m.ctx,
      multiplier: m.price,
    })),
  });
}

export { json };
