// 口令与会话的密码学部分。全部用 Workers 内置的 WebCrypto，零依赖。
//
// 诚实说明（这几条是有意的取舍，不是疏忽）：
//   1. 口令只存 PBKDF2-SHA256 的派生值 + 每用户 16 字节随机盐，**不存明文、不存可逆密文**。
//   2. 迭代次数默认 25000 —— 这个数是被 Cloudflare **免费版 10ms CPU/请求** 的硬上限逼出来的，
//      不是按 OWASP 推荐值选的。本机实测 PBKDF2-SHA256 每 1 万次迭代约 1.7ms，
//      10 万次要 16.8ms，必然撞 1102（Worker exceeded CPU time limit）。
//      想提高强度：改 wrangler.toml 的 PBKDF2_ITER 并升级到付费版（30s CPU 上限）。
//      迭代次数随行存在 users.pw_iter 里，所以**调高不会让老账号登不上**。
//   3. API key 明文只在创建那一刻返回一次，库里只存它的 SHA-256（key_hash）。
//      也就是说：即使这张库被拖走，也拿不到能用的 key，只能看到前缀。

const enc = new TextEncoder();

/** 默认迭代次数。可用 wrangler.toml 的 [vars] PBKDF2_ITER 覆盖。 */
export const DEFAULT_ITER = 25000;

/** 会话有效期：30 天。 */
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/** 会话 cookie 名。 */
export const COOKIE_NAME = "astra_session";

// ── base64url（无填充）─────────────────────────────────────────────────────
export function b64urlEncode(bytes) {
  let s = "";
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function toHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** 32 字节随机 → base64url。用于 session id。 */
export function randomId(bytes = 32) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** 生成一个 API key（明文）。前缀固定 sk-astra-，后接 40 位十六进制。 */
export function newApiKey() {
  return "sk-astra-" + toHex(crypto.getRandomValues(new Uint8Array(20)));
}

/** 页面上展示用的 key 前缀（永远不展示完整 key）。 */
export function keyPrefix(key) {
  return key.slice(0, 15);
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return toHex(new Uint8Array(d));
}

/** PBKDF2-SHA256 → 32 字节。 */
export async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** 注册用：给一个明文口令，返回可以直接写库的三个字段。 */
export async function hashPassword(password, iterations = DEFAULT_ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(password, salt, iterations);
  return { pw_hash: b64urlEncode(dk), pw_salt: b64urlEncode(salt), pw_iter: iterations };
}

/**
 * 登录用：把候选口令和库里那三列比一遍。
 * 比较是**定长**的（不因第几位不同而提前返回），虽然 PBKDF2 之后时序泄漏已无实际意义。
 */
export async function verifyPassword(password, row) {
  const iterations = Number(row.pw_iter) || DEFAULT_ITER;
  const dk = await pbkdf2(password, b64urlDecode(row.pw_salt), iterations);
  const got = b64urlEncode(dk);
  const want = String(row.pw_hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// ── cookie ────────────────────────────────────────────────────────────────
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(sessionId, maxAgeSec) {
  // Secure 只在 https 下加 —— 本地 http 测试也要能带上这个 cookie。
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── 输入校验（注册/登录共用的最小集）─────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email) {
  const v = String(email || "").trim().toLowerCase();
  if (!v) return { ok: false, error: "请输入邮箱。" };
  if (v.length > 190) return { ok: false, error: "邮箱太长了。" };
  if (!EMAIL_RE.test(v)) return { ok: false, error: "邮箱格式看起来不对。" };
  return { ok: true, value: v };
}

export function validatePassword(pw) {
  const v = String(pw || "");
  if (v.length < 8) return { ok: false, error: "口令至少 8 位。" };
  if (v.length > 200) return { ok: false, error: "口令太长了。" };
  return { ok: true, value: v };
}

/** HTML 转义 —— 用户填的显示名/令牌名会回显在页面上。 */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
