// Netlify Function entry: wraps the Express app with serverless-http.
// Bundled by `npm run build:netlify` into <repo>/netlify/functions/api.js (see netlify.toml).
import serverless from 'serverless-http';
import { createApp } from '../src/app.js';
import { createPostgresDb, initDb } from '../src/db.js';

let ready; // cached across warm invocations

async function init() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is not set');
  const db = await initDb(createPostgresDb(process.env.DATABASE_URL));
  return serverless(createApp(db));
}

export async function handler(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    ready ??= init();
    const run = await ready;
    return await run(event, context);
  } catch (err) {
    ready = undefined; // retry initialisation on the next request
    console.error('Function init failed:', err);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Server is not configured correctly (database unavailable)' }),
    };
  }
}
