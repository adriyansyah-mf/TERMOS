import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

/**
 * The server only ever stores ciphertext for vault content. Columns that are
 * plaintext (ids, timestamps, usernames, team names) are the metadata needed to
 * route and merge records, nothing more.
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- scrypt(authKey) where authKey is derived client-side from the password; the
  -- server never sees the password or the key that decrypts the vault.
  auth_hash           TEXT NOT NULL,
  auth_salt           TEXT NOT NULL,
  kdf                 TEXT NOT NULL,
  wrapped_key         TEXT NOT NULL,
  public_key          TEXT NOT NULL,
  wrapped_private_key TEXT NOT NULL,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  -- team key sealed to the member's X25519 public key
  wrapped_team_key TEXT NOT NULL,
  added_at         INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

-- scope is 'u:<userId>' for a personal vault or 't:<teamId>' for a team vault.
CREATE TABLE IF NOT EXISTS records (
  scope      TEXT NOT NULL,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  blob       TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS records_scope_seq ON records(scope, seq);
`

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)
  return db
}

/** Monotonic change counter shared by all scopes; clients pull "everything after N". */
export function nextSeq(db: DB): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as
    | { value: string }
    | undefined
  const next = (row ? Number(row.value) : 0) + 1
  db.prepare("INSERT INTO meta(key, value) VALUES('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    String(next)
  )
  return next
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
