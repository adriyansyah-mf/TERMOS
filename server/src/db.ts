import { readFileSync } from 'node:fs'
import pg from 'pg'

export type DB = pg.Pool
export type Tx = pg.PoolClient

// BIGINT (ms timestamps, sequence numbers) as JS numbers; all values stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v))

/**
 * Connection settings come from the environment. The password is normally read
 * from a Docker secret file (TERMOS_DB_PASSWORD_FILE) so it never sits in env output.
 */
export function poolConfig(env = process.env): pg.PoolConfig {
  const password = env.TERMOS_DB_PASSWORD_FILE
    ? readFileSync(env.TERMOS_DB_PASSWORD_FILE, 'utf8').trim()
    : env.TERMOS_DB_PASSWORD
  if (env.TERMOS_DATABASE_URL) return { connectionString: env.TERMOS_DATABASE_URL, max: 10 }
  return {
    host: env.TERMOS_DB_HOST ?? 'db',
    port: Number(env.TERMOS_DB_PORT ?? 5432),
    user: env.TERMOS_DB_USER ?? 'termos',
    database: env.TERMOS_DB_NAME ?? 'termos',
    password,
    ssl: env.TERMOS_DB_SSL === '1' ? { rejectUnauthorized: true } : undefined,
    max: Number(env.TERMOS_DB_POOL ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000
  }
}

/**
 * The server only ever stores ciphertext for vault content. Plaintext columns
 * (ids, timestamps, usernames, team names) are the metadata needed to route and merge.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE users (
    id                  UUID PRIMARY KEY,
    username            TEXT NOT NULL,
    -- scrypt(authKey); authKey is derived on the device, the password never leaves it
    auth_hash           TEXT NOT NULL,
    auth_salt           TEXT NOT NULL,
    kdf                 JSONB NOT NULL,
    wrapped_key         JSONB NOT NULL,
    public_key          TEXT NOT NULL,
    wrapped_private_key JSONB NOT NULL,
    is_admin            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

  CREATE TABLE devices (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  BIGINT NOT NULL,
    last_seen   BIGINT NOT NULL
  );
  CREATE INDEX devices_user ON devices (user_id);

  CREATE TABLE teams (
    id         UUID PRIMARY KEY,
    name       TEXT NOT NULL,
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE team_members (
    team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    wrapped_team_key JSONB NOT NULL,
    added_at         BIGINT NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );
  CREATE INDEX team_members_user ON team_members (user_id);

  CREATE SEQUENCE record_seq;

  -- scope is 'u:<userId>' for a personal vault or 't:<teamId>' for a team vault
  CREATE TABLE records (
    scope      TEXT NOT NULL,
    id         TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    blob       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    seq        BIGINT NOT NULL,
    PRIMARY KEY (scope, id)
  );
  CREATE INDEX records_scope_seq ON records (scope, seq);
  `,
  `
  -- Single-use sign-up codes issued by a server admin. Only a hash of the code is kept.
  -- "Used" is used_at, not a user reference: deleting the account must not revive the code.
  CREATE TABLE invites (
    id            UUID PRIMARY KEY,
    code_hash     TEXT NOT NULL UNIQUE,
    note          TEXT NOT NULL DEFAULT '',
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    BIGINT NOT NULL,
    expires_at    BIGINT NOT NULL,
    used_at       BIGINT,
    used_username TEXT
  );
  `
]

export async function openDb(config: pg.PoolConfig): Promise<DB> {
  const pool = new pg.Pool(config)
  pool.on('error', (err) => console.error('postgres pool error:', err.message))
  // Wait for the database (it may still be starting under docker compose).
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1')
      break
    } catch (err) {
      if (attempt >= 30) throw err
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  await migrate(pool)
  return pool
}

async function migrate(pool: DB): Promise<void> {
  await withTx(pool, async (c) => {
    // One server instance migrates at a time.
    await c.query('SELECT pg_advisory_xact_lock(4242)')
    await c.query('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    const r = await c.query<{ version: number }>('SELECT version FROM schema_version')
    let version = r.rows[0]?.version ?? 0
    if (!r.rows.length) await c.query('INSERT INTO schema_version VALUES (0)')
    for (; version < MIGRATIONS.length; version++) await c.query(MIGRATIONS[version])
    await c.query('UPDATE schema_version SET version = $1', [version])
  })
}

export async function withTx<T>(pool: DB, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    c.release()
  }
}

/**
 * Record writers take this lock for the whole transaction, so sequence numbers
 * become visible in order and a client pulling "everything after N" never skips a row.
 */
export const RECORD_WRITE_LOCK = 4243
