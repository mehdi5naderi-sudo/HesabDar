CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_owner_date
ON transactions (telegram_user_id, created_at, id);

CREATE TABLE IF NOT EXISTS bot_state (
  telegram_user_id TEXT PRIMARY KEY,
  pending_kind TEXT NOT NULL CHECK (pending_kind IN ('deposit', 'withdrawal'))
);
