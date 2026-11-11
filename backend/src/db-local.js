import { PGlite } from '@electric-sql/pglite';

/**
 * In-process Postgres (PGlite, WebAssembly) — real Postgres semantics with zero setup.
 * Used for local development when DATABASE_URL is not set, and for tests (in-memory).
 *
 * @param {string} [dataDir] directory to persist data in; omit for a throwaway in-memory database
 */
export async function createLocalDb(dataDir) {
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  return {
    async query(text, params = []) {
      const result = await pg.query(text, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    close: () => pg.close(),
    pglite: pg,
  };
}
