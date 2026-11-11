# Docs — a lightweight collaborative document editor

A small full-stack app for creating rich-text documents, importing files into them, and sharing them with other users.

**Stack:** React 18 + Vite + TipTap (ProseMirror) · Node/Express · PostgreSQL (Supabase in production, embedded PGlite locally)

**Hosting:** Netlify (static frontend + the API as a Netlify Function) + Supabase Postgres. Both are on free plans, with no card required.

## Features

| Area | What you can do |
|---|---|
| **Documents** | Create, rename (click the title), edit, delete. Autosaves 1 s after you stop typing; **Save** button and **Ctrl/Cmd+S** save immediately. A save-status indicator shows *Unsaved / Saving… / All changes saved / Save failed*, and you're warned before closing a tab with unsaved edits. |
| **Formatting** | Bold, italic, underline, strikethrough, H1/H2/H3, bulleted and numbered lists, block quotes, undo/redo. Standard shortcuts (Ctrl+B/I/U, Markdown-style `# `, `- `, `1. `) work too. |
| **File import** | **Import file** turns an uploaded **`.txt`, `.md` / `.markdown` or `.docx`** file (max **4 MB**) into a new editable document owned by you. Headings, bold/italic, lists and paragraphs are kept. Other types are rejected with a clear message. |
| **Sharing** | The owner opens **Share**, enters a user's email and picks **Can view** or **Can edit**. They can change the role or remove access later. The home page splits **My documents** (Owner) from **Shared with me** (shows the owner and your access level). Viewers get a read-only editor. Only the owner can share or delete. |
| **Persistence** | Documents, sharing and sessions are stored in PostgreSQL. Content is stored as sanitized HTML, so formatting survives a refresh exactly. |

### Demo accounts

All demo accounts use the password **`password123`**. The login page has one-click buttons for each.

| User | Email |
|---|---|
| Alice Owner | alice@example.com |
| Bob Collaborator | bob@example.com |
| Carol Reviewer | carol@example.com |

**Try sharing:** sign in as Alice, create a doc, then **Share** it with `bob@example.com` as *Can view*. In a private window, sign in as Bob. The doc appears under *Shared with me* and is read-only. Switch Bob to *Can edit* and his edits show up for Alice.

## Running locally

Requires **Node 18+** (Node 20 recommended).

```bash
npm run install:all     # installs backend + frontend deps

# Production-style: one process serves API + built UI on http://localhost:3001
npm run build
npm start

# Or for development, with hot reload (two terminals):
npm run dev:backend     # API on :3001
npm run dev:frontend    # UI on http://localhost:5173 (proxies /api → :3001)
```

**No database setup is needed locally.** When `DATABASE_URL` is not set, the backend uses **PGlite**, a real Postgres engine embedded in the Node process. It stores data in `backend/data/pglite/`. Tables and demo users are created on first start. Delete that folder to reset.

To run locally against Supabase (or any Postgres), set `DATABASE_URL` before starting.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `DATABASE_URL` | _(unset → embedded PGlite)_ | Postgres connection string (Supabase in production) |
| `LOCAL_DB_DIR` | `backend/data/pglite` | Where PGlite stores data when `DATABASE_URL` is unset |

### Tests

```bash
npm test
```

API-level integration tests (`backend/test/api.test.js`, Node's built-in test runner + supertest) run against a fresh **in-memory Postgres (PGlite)** per test, so the real SQL is exercised with no external database. They cover:

- auth
- create/rename/edit/reopen with formatting round-trip
- validation and XSS sanitization
- the full sharing lifecycle (viewer → editor → revoke, non-owners blocked, strangers get 404)
- `.md` / `.txt` / `.docx` import, including bad files
- Netlify function routing (`/.netlify/functions/api/*` maps to the same routes)

## Deployment (Netlify + Supabase, free)

How it fits together:
- `frontend/dist` is served by Netlify as static files.
- `/api/*` is rewritten to a single Netlify Function (`netlify/functions/api`). That function is the same Express app, wrapped with `serverless-http` and bundled by esbuild.
- The function connects to Supabase Postgres through `DATABASE_URL`.
- Tables and demo users are created automatically on the first request.

**1. Supabase (database)**
1. Create a free project at [supabase.com](https://supabase.com) and save the database password.
2. Click **Connect** → **Transaction pooler** (port `6543`) and copy the connection string.
3. Replace `[YOUR-PASSWORD]` in it with your password.

**2. Netlify (app)**
1. **Add new site** → **Import an existing project** → GitHub → pick this repo. `netlify.toml` already sets the build command, publish folder and functions folder.
2. Before deploying, add an environment variable: `DATABASE_URL` = the Supabase connection string.
3. Deploy, then open the site URL.

**Free-tier notes:**
- The first API request after idle time can take a few seconds (function cold start).
- Supabase pauses free projects after about 7 days without activity. Resume it from the Supabase dashboard if that happens.

**Live URL:** https://fastidious-starship-027a64.netlify.app

## Status

- **Working:** everything listed under Features, verified by automated tests and a two-user browser run. Screenshots are in [`docs/screenshots/`](docs/screenshots/).
- **Not built (deliberate scope cuts):**
  - real-time co-editing
  - export
  - comments
  - sign-up and password reset
  - session expiry
- **Known limitation:** concurrent edits are last-write-wins.
- **Next 2-4 hours:** version-checked saves (409 + reload prompt), session expiry and rate limiting, `.docx`/`.md` export, committed browser tests in CI.

## Project layout

```
backend/                Express API + PostgreSQL
  src/app.js            Routes, auth middleware, access checks, error handler
  src/db.js             Schema, demo-user seeding, Postgres client (Supabase)
  src/db-local.js       Embedded Postgres (PGlite) for local dev + tests
  netlify/handler.js    Netlify Function entry (wraps the Express app)
  src/importers.js      .txt/.md/.docx → HTML
  src/sanitize.js       HTML allow-list (XSS boundary)
  src/index.js          Local server entry point (also serves the built frontend)
  test/                 Integration tests + .docx fixture
frontend/               React + TipTap UI
  src/App.jsx           Session handling + hash routing
  src/components/       Login, DocList, DocEditor, Toolbar, SharePanel
  src/services/         api.js (HTTP calls to the backend), navigation.js
  src/utils/            format.js (date formatting)
netlify.toml            Netlify build, functions and /api rewrite
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions and trade-offs, and [AI_WORKFLOW.md](AI_WORKFLOW.md) for how AI tools were used and checked.
