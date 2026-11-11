import postgres from 'postgres';
import bcrypt from 'bcryptjs';

/**
 * Database layer.
 *
 * Everything talks to a tiny `{ query(text, params) → { rows, rowCount }, close() }` interface so the
 * same SQL runs against:
 *   - Supabase / any Postgres (production, via DATABASE_URL) — createPostgresDb()
 *   - PGlite, an in-process Postgres (local dev without setup + tests) — see db-local.js
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id            SERIAL PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE,          -- always stored lower-cased
     name          TEXT NOT NULL,
     password_hash TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token      TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS documents (
     id         SERIAL PRIMARY KEY,
     owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title      TEXT NOT NULL,
     content    TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS document_shares (
     document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (document_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_shares_user ON document_shares(user_id)`,
];

export const SEED_PASSWORD = 'password123';
export const SEED_USERS = [
  { email: 'alice@example.com', name: 'Alice Owner' },
  { email: 'bob@example.com', name: 'Bob Collaborator' },
  { email: 'carol@example.com', name: 'Carol Reviewer' },
];

/** Create tables if missing and seed the demo users. Safe to run on every start (idempotent). */
export async function initDb(db) {
  for (const statement of SCHEMA) await db.query(statement);

  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const hash = bcrypt.hashSync(SEED_PASSWORD, 10);
    for (const u of SEED_USERS) {
      await db.query(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
        [u.email, u.name, hash],
      );
    }
  }
  return db;
}

/** Postgres over the network (Supabase in production). */
export function createPostgresDb(connectionString) {
  const host = new URL(connectionString).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const sql = postgres(connectionString, {
    max: 3,               // serverless: keep few connections per instance
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,       // required for Supabase's transaction pooler (port 6543)
    ssl: isLocal ? false : 'require',
    onnotice: () => {},
  });
  return {
    async query(text, params = []) {
      const result = await sql.unsafe(text, params);
      return { rows: Array.from(result), rowCount: result.count };
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
