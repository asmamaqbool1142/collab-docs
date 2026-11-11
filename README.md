# Docs — a lightweight collaborative document editor

A small full-stack app for creating rich-text documents, importing files into them, and sharing them with other users.

**Stack:** React 18 + Vite + TipTap (ProseMirror) · Node/Express · SQLite (better-sqlite3)

## Features

| Area | What you can do |
|---|---|
| **Documents** | Create, rename (click the title), edit, delete. Autosaves 1 s after you stop typing; **Save** button and **Ctrl/Cmd+S** save immediately. A save-status indicator shows *Unsaved / Saving… / All changes saved / Save failed*, and you're warned before closing a tab with unsaved edits. |
| **Formatting** | Bold, italic, underline, strikethrough, H1/H2/H3, bulleted and numbered lists, block quotes, undo/redo. Standard shortcuts (Ctrl+B/I/U, Markdown-style `# `, `- `, `1. `) work too. |
| **File import** | **Import file** turns an uploaded **`.txt`, `.md` / `.markdown` or `.docx`** file (max **5 MB**) into a new editable document owned by you. Headings, bold/italic, lists and paragraphs are kept. Other types are rejected with a clear message. |
| **Sharing** | The owner opens **Share**, enters a user's email and picks **Can view** or **Can edit**. They can change the role or remove access later. The home page splits **My documents** (Owner) from **Shared with me** (shows the owner and your access level). Viewers get a read-only editor. Only the owner can share or delete. |
| **Persistence** | Documents, sharing and sessions are stored in SQLite. Content is stored as sanitized HTML, so formatting survives a refresh exactly. |

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

The database is created automatically at `backend/data/docs.db` and the demo users are seeded on first start. Delete that file to reset.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `DATABASE_PATH` | `backend/data/docs.db` | SQLite file location |

### Tests

```bash
npm test
```

API-level integration tests (`backend/test/api.test.js`, Node's built-in test runner + supertest) run against an in-memory database. They cover:

- auth
- create/rename/edit/reopen with formatting round-trip
- validation and XSS sanitization
- the full sharing lifecycle (viewer → editor → revoke, non-owners blocked, strangers get 404)
- `.md` / `.txt` / `.docx` import, including bad files

## Deployment

The app ships as a single Docker image: the frontend is built into static files that Express serves next to the API.

- **Render (live demo, free plan):** Render → *New* → *Web Service* (or *Blueprint* using `render.yaml`) → select the repo → runtime **Docker**, instance **Free**, health check `/api/health`, env `DATABASE_PATH=/data/docs.db`.
  - **Free-plan caveats:**
    - There is no persistent disk, so documents reset when the service restarts or redeploys. The demo users are re-seeded automatically.
    - The service sleeps after ~15 minutes idle, so the first request can take about 50 seconds.
  - **For durable data:** use a paid instance with a disk mounted at `/data` (see the commented block in `render.yaml`).
- **Any Docker host** (Fly.io, Railway, a VM):
  ```bash
  docker build -t docs-app .
  docker run -p 3001:3001 -v docs-data:/data docs-app
  ```
  Mount a volume at `/data`, or the data is lost when the container restarts.

**Live URL:** _see SUBMISSION.md_

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
backend/                Express API + SQLite
  src/app.js            Routes, auth middleware, access checks, error handler
  src/db.js             Schema + demo-user seeding
  src/importers.js      .txt/.md/.docx → HTML
  src/sanitize.js       HTML allow-list (XSS boundary)
  src/index.js          Server entry point (also serves the built frontend)
  test/                 Integration tests + .docx fixture
frontend/               React + TipTap UI
  src/App.jsx           Session handling + hash routing
  src/components/       Login, DocList, DocEditor, Toolbar, SharePanel
  src/services/         api.js (HTTP calls to the backend), navigation.js
  src/utils/            format.js (date formatting)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions and trade-offs, and [AI_WORKFLOW.md](AI_WORKFLOW.md) for how AI tools were used and checked.
