/**
 * 零依赖 QR 码编码器（纯 ESM，可直接部署到 Cloudflare Workers）。
 *
 * 固定参数：byte 模式 / 版本 7（45×45 模块）/ 纠错等级 M / 不写 ECI 头。
 * 本文件不 import 任何东西，也不使用任何 Node 内置模块；只用到标准全局 TextEncoder。
 *
 * 所有结构参数（RS 分块表、版本信息位、对齐图案坐标、格式信息位、掩码惩罚打分）
 * 均按 ISO/IEC 18004 推导，并与 segno 1.6.6 逐位比对通过；证据见 _qr_selftest.md。
 *
 * 注意：数据区「补到码字边界」这一步本文件刻意复刻了 segno 的语义（已对齐时仍补
 * 8 位），以便与参考实现逐位一致；这与 ISO 7.4.10 的字面规定不同，详见报告。
 */

export const QR_VERSION = 7;
export const QR_SIZE = 45;
export const QR_CAPACITY = 122; // byte 模式容量（字节）

/* ==================== 版本 7 / 纠错 M 的结构参数 ==================== */

// ISO/IEC 18004 Table 9：版本 7 共 196 个码字，M 级为 4 块 × (31 数据 + 18 纠错)。
const NUM_BLOCKS = 4;
const DATA_PER_BLOCK = 31;
const EC_PER_BLOCK = 18;
const DATA_CODEWORDS = NUM_BLOCKS * DATA_PER_BLOCK; // 124
const CAPACITY_BITS = DATA_CODEWORDS * 8; // 992

// Annex E：版本 7 的对齐图案中心坐标
const ALIGNMENT_CENTERS = [6, 22, 38];

// ISO/IEC 18004 7.4.10：填充码字 11101100 / 00010001 交替
const PAD_CODEWORDS = [0xec, 0x11];

/* ==================== GF(256)，本原多项式 0x11D ==================== */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** 生成多项式 g(x)=∏(x-α^i)，i=0..n-1；返回升幂系数数组，长度 n+1，最高次系数为 1。 */
function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const a = GF_EXP[i];
    const next = new Array(g.length + 1).fill(0);
    for (let k = 0; k < g.length; k++) {
      next[k] ^= gfMul(a, g[k]);
      next[k + 1] ^= g[k];
    }
    g = next;
  }
  return g;
}

const RS_GEN = rsGenerator(EC_PER_BLOCK);

/** 扩展综合除法求余：返回 data 的 EC_PER_BLOCK 个纠错码字。 */
function rsEncode(data) {
  const n = EC_PER_BLOCK;
  const buf = new Uint8Array(data.length + n);
  buf.set(data, 0);
  for (let k = 0; k < data.length; k++) {
    const coef = buf[k];
    if (coef === 0) continue;
    for (let j = 0; j < n; j++) buf[k + n - j] ^= gfMul(coef, RS_GEN[j]);
  }
  return buf.slice(data.length);
}

/* ==================== 数据段与纠错 ==================== */

function buildDataCodewords(bytes) {
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  push(0b0100, 4); // byte 模式指示符
  push(bytes.length, 8); // 字符计数（版本 1–9 的 byte 模式为 8 位）
  for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);

  // 终止符：最多 4 个 0
  const term = Math.min(4, CAPACITY_BITS - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);

  // 补到码字边界（复刻 segno：已对齐时补满 8 位）
  const padBits = 8 - (bits.length % 8);
  for (let i = 0; i < padBits; i++) bits.push(0);

  // 填充码字，直到填满数据容量
  let pi = 0;
  while (bits.length < CAPACITY_BITS) push(PAD_CODEWORDS[pi++ % 2], 8);

  // 取前 DATA_CODEWORDS 个码字（超出部分按规范丢弃）
  const cw = new Uint8Array(DATA_CODEWORDS);
  for (let i = 0; i < DATA_CODEWORDS; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    cw[i] = v;
  }
  return cw;
}

/** 分块 → 纠错 → 按 ISO 7.6 交织。 */
function interleaveWithEc(dataCodewords) {
  const blocks = [];
  for (let b = 0; b < NUM_BLOCKS; b++) {
    const start = b * DATA_PER_BLOCK;
    const data = dataCodewords.slice(start, start + DATA_PER_BLOCK);
    blocks.push({ data, ec: rsEncode(data) });
  }
  const out = new Uint8Array(NUM_BLOCKS * (DATA_PER_BLOCK + EC_PER_BLOCK));
  let p = 0;
  for (let i = 0; i < DATA_PER_BLOCK; i++) {
    for (let b = 0; b < NUM_BLOCKS; b++) out[p++] = blocks[b].data[i];
  }
  for (let i = 0; i < EC_PER_BLOCK; i++) {
    for (let b = 0; b < NUM_BLOCKS; b++) out[p++] = blocks[b].ec[i];
  }
  return out;
}

/* ==================== 矩阵构造 ==================== */

function newGrid(size, fill) {
  const g = [];
  for (let y = 0; y < size; y++) g.push(new Uint8Array(size).fill(fill));
  return g;
}

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

const ALIGN = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
];

/**
 * 铺功能图案（定位/分隔/时序/对齐/版本信息区/格式信息区/固定深色模块），
 * 并标出「非编码区」以便掩码与数据放置跳过。
 */
function buildBase() {
  const size = QR_SIZE;
  const mod = newGrid(size, 0);
  const func = newGrid(size, 0);
  const mark = (x, y, v) => {
    mod[y][x] = v;
    func[y][x] = 1;
  };

  // 版本信息区（版本 ≥ 7 才有）：右上 6×3、左下 3×6
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 3; k++) {
      mark(size - 11 + k, i, 0);
      mark(i, size - 11 + k, 0);
    }
  }

  // 格式信息区：第 8 行 / 第 8 列
  for (let i = 0; i < 9; i++) {
    mark(8, i, 0);
    mark(i, 8, 0);
  }
  for (let i = 1; i <= 8; i++) {
    mark(8, size - i, 0);
    mark(size - i, 8, 0);
  }

  // 时序图案：第 6 行与第 6 列
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    mark(i, 6, v);
    mark(6, i, v);
  }

  // 三个定位图案（含 1 模块宽分隔符）
  const putFinder = (x0, y0) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        mark(x, y, inside ? FINDER[dy][dx] : 0);
      }
    }
  };
  putFinder(0, 0);
  putFinder(size - 7, 0);
  putFinder(0, size - 7);

  // 对齐图案（跳过与定位图案重叠的三个）
  for (let a = 0; a < ALIGNMENT_CENTERS.length; a++) {
    for (let b = 0; b < ALIGNMENT_CENTERS.length; b++) {
      const cx = ALIGNMENT_CENTERS[b];
      const cy = ALIGNMENT_CENTERS[a];
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === 38) || (cx === 38 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy, ALIGN[dy + 2][dx + 2]);
      }
    }
  }

  return { mod, func };
}

/** ISO/IEC 18004 7.7.3：从右下角起、两列一组上下蛇形放置比特（跳过第 6 列）。 */
function placeData(mod, func, codewords) {
  const size = QR_SIZE;
  const bits = [];
  for (let i = 0; i < codewords.length; i++) {
    const cw = codewords[i];
    for (let k = 7; k >= 0; k--) bits.push((cw >> k) & 1);
  }

  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      for (let z = 0; z < 2; z++) {
        const x = right - z;
        const y = upward ? size - 1 - vert : vert;
        if (!func[y][x] && idx < bits.length) {
          mod[y][x] = bits[idx];
          idx++;
        }
      }
    }
  }
  return idx;
}

/* ==================== 掩码 ==================== */

function maskBit(mask, x, y) {
  switch (mask) {
    case 0:
      return ((x + y) & 1) === 0;
    case 1:
      return (y & 1) === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return ((Math.floor(y / 2) + Math.floor(x / 3)) & 1) === 0;
    case 5:
      return ((x * y) & 1) + ((x * y) % 3) === 0;
    case 6:
      return ((((x * y) & 1) + ((x * y) % 3)) & 1) === 0;
    case 7:
      return ((((x + y) & 1) + ((x * y) % 3)) & 1) === 0;
    default:
      return false;
  }
}

function applyMaskTo(m, func, mask) {
  const size = QR_SIZE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!func[y][x] && maskBit(mask, x, y)) m[y][x] ^= 1;
    }
  }
}

const N3_PATTERN = [1, 0, 1, 1, 1, 0, 1];

function patternAt(seq, i) {
  for (let k = 0; k < 7; k++) if (seq[i + k] !== N3_PATTERN[k]) return false;
  return true;
}

function findPattern(seq, from, size) {
  for (let i = from; i + 7 <= size; i++) if (patternAt(seq, i)) return i;
  return -1;
}

function anyDark(seq, a, b) {
  for (let i = a; i < b; i++) if (seq[i]) return true;
  return false;
}

/** 1:1:3:1:1 图案出现次数（前后 4 模块须为浅色），每次 40 分。 */
function n3Occurrences(seq, size) {
  let count = 0;
  let idx = findPattern(seq, 0, size);
  while (idx !== -1) {
    let offset = idx + 7;
    const ok =
      idx === 0 ||
      idx === size - 7 ||
      !anyDark(seq, Math.max(idx - 4, 0), Math.min(idx, size)) ||
      !anyDark(seq, Math.max(offset, 0), Math.min(offset + 4, size));
    if (ok) count += 40;
    else offset = idx + 4;
    idx = findPattern(seq, offset, size);
  }
  return count;
}

/** ISO/IEC 18004 7.8.3 Table 11：N1=3 N2=3 N3=40 N4=10。 */
function maskScores(m, size) {
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  let dark = 0;
  let lastRow = null;
  const col = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const row = m[i];
    let rowPrev = -1;
    let colPrev = -1;
    let n1Row = 0;
    let n1Col = 0;
    for (let j = 0; j < size; j++) {
      const rb = row[j];
      const cb = m[j][i];
      col[j] = cb;
      dark += rb;

      if (rb === rowPrev) n1Row++;
      else {
        if (n1Row >= 5) n1 += n1Row - 2;
        n1Row = 1;
      }
      if (cb === colPrev) n1Col++;
      else {
        if (n1Col >= 5) n1 += n1Col - 2;
        n1Col = 1;
      }
      if (lastRow && j && rb === rowPrev && rb === lastRow[j] && rb === lastRow[j - 1]) n2 += 3;

      rowPrev = rb;
      colPrev = cb;
    }
    lastRow = row;
    n3 += n3Occurrences(row, size);
    n3 += n3Occurrences(col, size);
    if (n1Row >= 5) n1 += n1Row - 2;
    if (n1Col >= 5) n1 += n1Col - 2;
  }

  const percent = dark / (size * size);
  const n4 = 10 * Math.trunc(Math.abs(percent * 100 - 50) / 5);
  return n1 + n2 + n3 + n4;
}

function chooseMask(baseMod, func) {
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const trial = baseMod.map((r) => Uint8Array.from(r));
    applyMaskTo(trial, func, mask);
    const score = maskScores(trial, QR_SIZE);
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
  }
  return best;
}

/* ==================== 格式信息 / 版本信息 ==================== */

function bitOf(v, i) {
  return (v >>> i) & 1;
}

/** BCH(15,5)，生成多项式 0x537，再与 0x5412 异或。纠错 M 的 2 位标识为 00。 */
function formatBits(mask) {
  const data = (0x00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = ((rem << 1) ^ (((rem >>> 9) & 1) * 0x537)) & 0x7ff;
  return ((data << 10) | rem) ^ 0x5412;
}

/** BCH(18,6)，生成多项式 0x1F25。 */
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = ((rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25)) & 0x3fff;
  return (version << 12) | rem;
}

function writeFormatInfo(m, mask) {
  const size = QR_SIZE;
  const bits = formatBits(mask);
  for (let i = 0; i <= 5; i++) m[i][8] = bitOf(bits, i);
  m[7][8] = bitOf(bits, 6);
  m[8][8] = bitOf(bits, 7);
  m[8][7] = bitOf(bits, 8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bitOf(bits, i);

  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bitOf(bits, i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bitOf(bits, i);
}

function writeVersionInfo(m) {
  const size = QR_SIZE;
  const bits = versionBits(QR_VERSION);
  for (let i = 0; i < 18; i++) {
    const b = bitOf(bits, i);
    const a = size - 11 + (i % 3);
    const c = Math.floor(i / 3);
    m[c][a] = b;
    m[a][c] = b;
  }
}

/* ==================== 对外接口 ==================== */

const UTF8 = new TextEncoder();

/**
 * 生成 45×45 矩阵。返回 45 个字符串的数组，每串 45 个 '0'/'1'（'1' = 深色）。
 * text 按 UTF-8 字节编码，不加 ECI 头；超过 122 字节抛错。
 */
export function qrMatrix(text) {
  const bytes = UTF8.encode(text);
  if (bytes.length > QR_CAPACITY) {
    throw new Error("payload too long: " + bytes.length + " bytes > 122");
  }

  const dataCodewords = buildDataCodewords(bytes);
  const finalCodewords = interleaveWithEc(dataCodewords);

  const { mod, func } = buildBase();
  placeData(mod, func, finalCodewords);

  const mask = chooseMask(mod, func);
  applyMaskTo(mod, func, mask);
  writeFormatInfo(mod, mask);
  writeVersionInfo(mod);
  mod[QR_SIZE - 8][8] = 1; // 固定深色模块

  const rows = [];
  for (let y = 0; y < QR_SIZE; y++) {
    let s = "";
    for (let x = 0; x < QR_SIZE; x++) s += mod[y][x] ? "1" : "0";
    rows.push(s);
  }
  return rows;
}

function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 渲染成内联 SVG。矩阵画在 +2 偏移处，49 的 viewBox 自带 2 模块静区；
 * path 用逐行游程编码，不写 fill（默认黑）。
 */
export function qrSvg(text, opts) {
  const o = opts || {};
  const size = o.size === undefined ? 186 : o.size;
  const label = o.label === undefined ? "充值二维码" : o.label;

  const rows = qrMatrix(text);
  let d = "";
  for (let y = 0; y < QR_SIZE; y++) {
    const row = rows[y];
    let x = 0;
    while (x < QR_SIZE) {
      if (row[x] === "1") {
        let w = 1;
        while (x + w < QR_SIZE && row[x + w] === "1") w++;
        d += "M" + (x + 2) + " " + (y + 2) + "h" + w + "v1h-" + w + "z";
        x += w;
      } else {
        x++;
      }
    }
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 49 49" width="' +
    size +
    '" height="' +
    size +
    '" shape-rendering="crispEdges" role="img" aria-label="' +
    escAttr(label) +
    '"><rect width="49" height="49" fill="#ffffff"/><path d="' +
    d +
    '"/></svg>'
  );
}
