/**
 * 充值页「扫码支付」的二维码载荷。
 *
 * 关键事实：二维码里编码的是一个 **URL**，扫出来打开的是 /pay 这个 HTML 页，
 * 页面里是一张奶龙图。它不是收款码，本站也没有任何收款能力 ——
 * 支付宝/微信扫它只会把它当普通链接打开，不会有任何付款动作。
 *
 * 载荷形如：
 *   https://api.caar.fun/pay?a=100&c=alipay&o=20261007114208831&s=9f3a1c2e
 * 其中 a=金额、c=渠道、o=订单号（由时间派生）、s=随机盐。
 * 「加盐」的含义就是 s 每次都不一样 —— 所以切换额度或渠道、甚至只是刷新页面，
 * 二维码都会变（同一金额+渠道也不会重复）。
 */
import { QR_CAPACITY, qrSvg } from "./qr.js";

export const CHANNELS = ["alipay", "wechat"];
export const CHANNEL_LABEL = { alipay: "支付宝", wechat: "微信支付" };
export const PLAN_AMOUNTS = [10, 50, 100, 300, 500, 1000];
export const PLAN_BONUS = [0, 5, 15, 60, 120, 300];
export const PLAN_TAG = ["", "", "最受欢迎", "", "推荐", ""];
export const MIN_AMOUNT = 10;
export const MAX_AMOUNT = 100000;

/** 把任意输入夹成一个合法的充值金额（两位小数）。非法输入返回默认值。 */
export function clampAmount(raw, fallback = 100) {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw == null ? "" : raw).replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n <= 0) return fallback;
  const v = Math.round(n * 100) / 100;
  if (v < MIN_AMOUNT) return MIN_AMOUNT;
  if (v > MAX_AMOUNT) return MAX_AMOUNT;
  return v;
}

/** 渠道名归一化；不认识的渠道一律当支付宝。 */
export function clampChannel(raw) {
  return CHANNELS.indexOf(String(raw || "")) >= 0 ? String(raw) : "alipay";
}

/** 按 GMT+8 拆出时间分量（订单号与页面显示都用东八区，口径要一致）。 */
function gmt8(ms) {
  return new Date((Number(ms) || 0) + 8 * 3600 * 1000);
}

/**
 * 订单号：17 位数字，形如 20261007114208831（YYYYMMDDHHmmss + 毫秒后三位）。
 * 纯由时间派生 —— 不含自增 id，所以不会泄露全站兑换/下单总量。
 */
export function orderNo(ms) {
  const t = Number(ms) || 0;
  const d = gmt8(t);
  const p = (n, w) => String(n).padStart(w, "0");
  return (
    p(d.getUTCFullYear(), 4) + p(d.getUTCMonth() + 1, 2) + p(d.getUTCDate(), 2) +
    p(d.getUTCHours(), 2) + p(d.getUTCMinutes(), 2) + p(d.getUTCSeconds(), 2) +
    p(t % 1000, 3)
  );
}

/** 随机盐：4 字节 → 8 位十六进制。 */
export function newSalt(bytes = 4) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/** 二维码里编码的那个 URL。 */
export function payUrl(origin, { amount, channel, order, salt }) {
  return (
    String(origin || "") + "/pay?a=" + encodeURIComponent(amount) +
    "&c=" + encodeURIComponent(channel) +
    "&o=" + encodeURIComponent(order) +
    "&s=" + encodeURIComponent(salt)
  );
}

/** UTF-8 字节数（QR 容量是按字节算的）。 */
function utf8Len(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/**
 * 生成一张充值二维码（含金额、渠道、订单号、随机盐）。
 * 返回 { amount, channel, order, salt, url, svg }。
 * 万一 origin 很长导致载荷超容量，就逐步缩短盐，保证永远能出图。
 */
export function makePayQr(origin, { amount = 100, channel = "alipay", salt = null } = {}) {
  const amt = clampAmount(amount);
  const ch = clampChannel(channel);
  const order = orderNo(Date.now());
  let s = salt == null ? newSalt() : String(salt);
  let url = payUrl(origin, { amount: amt, channel: ch, order, salt: s });
  while (utf8Len(url) > QR_CAPACITY && s.length > 2) {
    s = s.slice(0, s.length - 2);
    url = payUrl(origin, { amount: amt, channel: ch, order, salt: s });
  }
  return { amount: amt, channel: ch, order, salt: s, url, svg: qrSvg(url, { size: 186, label: "充值二维码" }) };
}
