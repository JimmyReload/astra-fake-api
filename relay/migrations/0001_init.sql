-- Astra Relay 的真数据库 schema（Cloudflare D1 / SQLite）。
--
-- 说清楚这里的诚实边界：
--   * 这张库**真的**存账号、会话、令牌、调用日志 —— 登录、控制台、令牌管理、调用日志
--     全部由它驱动，不是写死的假数据。
--   * 口令**只存 PBKDF2-SHA256 的派生值 + 每用户随机盐**，从不存明文、也从不存可逆密文。
--     迭代次数随行存在 pw_iter 里，以后调高不会让老账号登不上。
--   * API key（sk-astra-…）本身也**不落库**，只存它的 SHA-256，页面上的前缀是单独存的展示字段。
--   * 本站不接任何真实模型上游：/v1/* 永远返回同一张奶龙图，日志记的是"这次调用发生过"，
--     记的 token 数是编的（因为根本没调上游）。

-- 账号
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL DEFAULT '',
  pw_hash       TEXT    NOT NULL,                 -- base64(PBKDF2-SHA256(pw, salt, pw_iter))
  pw_salt       TEXT    NOT NULL,                 -- base64(16 字节随机盐)
  pw_iter       INTEGER NOT NULL,                 -- 迭代次数（随行存）
  group_name    TEXT    NOT NULL DEFAULT 'default',
  balance       REAL    NOT NULL DEFAULT 0,       -- 余额（元）。注册就是 0，只能靠兑换码加
  status        INTEGER NOT NULL DEFAULT 1,       -- 1 正常 / 0 停用
  created_at    INTEGER NOT NULL,                 -- unix ms
  last_login_at INTEGER
);

-- 会话（登录态）。cookie 里只放随机的 session id，服务端按它查库。
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,                 -- base64url(32 字节随机)
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua         TEXT    NOT NULL DEFAULT '',
  ip         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- API 令牌。key 明文只在创建那一刻返回一次，库里只有它的 SHA-256。
CREATE TABLE IF NOT EXISTS tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  key_prefix   TEXT    NOT NULL,                  -- 形如 sk-astra-a1b2c3，仅用于页面展示
  key_hash     TEXT    NOT NULL,                  -- sha256(key) 十六进制
  status       INTEGER NOT NULL DEFAULT 1,        -- 1 启用 / 0 禁用
  remain_quota REAL    NOT NULL DEFAULT 0,        -- 演示额度（元）
  used_quota   REAL    NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL DEFAULT -1        -- -1 = 永不过期
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(key_hash);

-- 调用日志。只记元数据（模型名、token 数、耗时、状态），**不记请求体、不记响应体**。
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id   INTEGER,
  model      TEXT    NOT NULL,
  in_tokens  INTEGER NOT NULL DEFAULT 0,
  out_tokens INTEGER NOT NULL DEFAULT 0,
  cost       REAL    NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status     INTEGER NOT NULL DEFAULT 200,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_user_time ON logs(user_id, created_at DESC);

-- 站内公告（首页/控制台/状态页读它，所以改公告不用重新部署）
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  level      TEXT    NOT NULL DEFAULT 'info',     -- info / warn / success
  created_at INTEGER NOT NULL
);

-- 兑换码。本站**唯一**的「充值」方式：没有支付流程、没有订单、没有二维码。
-- 想加余额只能拿一个码来换；码是一次性的，换过就废。
CREATE TABLE IF NOT EXISTS redeem_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,             -- 统一大写存储，兑换时也大写归一
  amount     REAL    NOT NULL,                    -- 兑换后加多少余额（元）
  note       TEXT    NOT NULL DEFAULT '',         -- 给码写个来源备注，页面上不展示
  status     TEXT    NOT NULL DEFAULT 'unused',   -- unused / used
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_status ON redeem_codes(status);
CREATE INDEX IF NOT EXISTS idx_redeem_used_by ON redeem_codes(used_by);

-- 预设的那一个兑换码：100 元额度。
-- 之所以预置在这里而不是运行时生成：它是"站长发出去的那张券"，属于数据不是代码。
-- 想再加码：INSERT INTO redeem_codes (code, amount, note, created_at) VALUES ('XXX', 50, '...', <ms>);
INSERT OR IGNORE INTO redeem_codes (code, amount, note, status, created_at)
VALUES ('NAILONG-100', 100, '预设码：100 元额度（整活站，无真实服务）', 'unused', 1759766400000);
