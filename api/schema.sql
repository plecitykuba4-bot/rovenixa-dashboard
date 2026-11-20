CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  city TEXT DEFAULT '',
  web TEXT DEFAULT '',
  preview TEXT DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'novy',
  price INTEGER DEFAULT 0,
  next_date TEXT DEFAULT '',
  next_action TEXT DEFAULT '',
  sent_date TEXT DEFAULT '',
  note TEXT DEFAULT '',
  source TEXT DEFAULT '',
  made_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS money (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'prijem',
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'zaplaceno',
  client_id INTEGER,
  label TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  client_id INTEGER,
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS i_cl_stage ON clients(stage);
CREATE INDEX IF NOT EXISTS i_act_date ON activity(date);
