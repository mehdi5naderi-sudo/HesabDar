-- Safe, repeatable schema setup. Do not drop tables: they contain the accounting history.
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (telegram_user_id, id);

CREATE TABLE IF NOT EXISTS balance_messages (
  telegram_user_id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL
);
