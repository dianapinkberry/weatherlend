-- Weatherlend schema.
-- Phenomena, size categories and neighbourhoods are data, not code:
-- add a row and it shows up in filters and forms without any code change.

CREATE TABLE phenomena (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  short_name TEXT NOT NULL,          -- label used on chips and cards
  tint       TEXT NOT NULL DEFAULT '#E4E7E5', -- card background colour
  ink        TEXT NOT NULL DEFAULT '#3B4A47', -- accent text colour
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE size_categories (
  slug           TEXT PRIMARY KEY,   -- small | medium | large
  name           TEXT NOT NULL,
  points_per_day INTEGER NOT NULL CHECK (points_per_day > 0),
  examples       TEXT,
  sort           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE neighbourhoods (
  name TEXT PRIMARY KEY
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  neighbourhood TEXT REFERENCES neighbourhoods(name),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2 of onboarding: phenomena a user wants to hear about.
CREATE TABLE user_phenomena (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phenomenon_id INTEGER NOT NULL REFERENCES phenomena(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, phenomenon_id)
);

CREATE TABLE items (
  id                INTEGER PRIMARY KEY,
  owner_id          INTEGER NOT NULL REFERENCES users(id),
  name              TEXT NOT NULL,
  size              TEXT NOT NULL REFERENCES size_categories(slug),
  description       TEXT,
  -- Seasonal availability that repeats every year, as months 1..12.
  -- from 11 / until 2 means November to February. Both NULL = all year.
  available_from_month  INTEGER CHECK (available_from_month BETWEEN 1 AND 12),
  available_until_month INTEGER CHECK (available_until_month BETWEEN 1 AND 12),
  availability_note TEXT,            -- e.g. "short notice, all year"
  neighbourhood     TEXT REFERENCES neighbourhoods(name),
  photo             TEXT,            -- small JPEG as data URL (optional)
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An item can belong to several phenomena. The first one (sort = 0) is the main one.
CREATE TABLE item_phenomena (
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  phenomenon_id INTEGER NOT NULL REFERENCES phenomena(id) ON DELETE CASCADE,
  sort          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, phenomenon_id)
);

-- "I need X from ... to ..." posts.
CREATE TABLE needs (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  phenomenon_id INTEGER REFERENCES phenomena(id),
  size          TEXT NOT NULL DEFAULT 'small' REFERENCES size_categories(slug),
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  neighbourhood TEXT REFERENCES neighbourhoods(name),
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fulfilled','closed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A loan is one borrowing of one item for an inclusive date range.
-- pending  -> borrower asked, owner has not answered (points reserved, not moved)
-- accepted -> points moved via the ledger
-- declined / cancelled -> nothing moved
CREATE TABLE loans (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  lender_id   INTEGER NOT NULL REFERENCES users(id),
  borrower_id INTEGER NOT NULL REFERENCES users(id),
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  days        INTEGER NOT NULL CHECK (days > 0),
  points      INTEGER NOT NULL CHECK (points >= 0),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  need_id     INTEGER REFERENCES needs(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
);
CREATE INDEX loans_item_dates ON loans(item_id, start_date, end_date);

-- Points ledger: the balance is always SUM(amount). Nothing is stored twice.
CREATE TABLE ledger (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('welcome','lend','borrow','adjust')),
  loan_id    INTEGER REFERENCES loans(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ledger_user ON ledger(user_id);
