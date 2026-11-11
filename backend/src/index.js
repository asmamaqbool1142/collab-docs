import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.join(here, '..', 'data', 'docs.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = createDb(dbPath);
const app = createApp(db, { frontendDist: path.join(here, '..', '..', 'frontend', 'dist') });
const port = Number(process.env.PORT) || 3001;

app.listen(port, () => console.log(`Docs app listening on http://localhost:${port} (db: ${dbPath})`));
