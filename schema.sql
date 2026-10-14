DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS balance_messages;

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_transactions_user ON transactions (telegram_user_id, id);

CREATE TABLE balance_messages (
  telegram_user_id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL
);
