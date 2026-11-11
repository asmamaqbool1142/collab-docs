// Local / plain-Node entry point. (On Netlify, netlify/handler.js is used instead.)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPostgresDb, initDb } from './db.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function openDb() {
  if (process.env.DATABASE_URL) {
    console.log('Using Postgres from DATABASE_URL');
    return createPostgresDb(process.env.DATABASE_URL);
  }
  // No database configured: use an embedded Postgres (PGlite) stored on disk — zero setup.
  const { createLocalDb } = await import('./db-local.js');
  const dataDir = process.env.LOCAL_DB_DIR || path.join(here, '..', 'data', 'pglite');
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Using embedded Postgres (PGlite) at ${dataDir}`);
  return createLocalDb(dataDir);
}

const db = await initDb(await openDb());
const app = createApp(db, { frontendDist: path.join(here, '..', '..', 'frontend', 'dist') });
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Docs app listening on http://localhost:${port}`));
