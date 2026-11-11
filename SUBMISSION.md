# Submission contents

| Item | Location |
|---|---|
| **Live product URL** | https://fastidious-starship-027a64.netlify.app (see the hosting note below) |
| **Walkthrough video** | `VIDEO_URL.txt` |
| Source code | `backend/` (Express API + PostgreSQL), `frontend/` (React + TipTap) |
| Setup & run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| Automated tests | `backend/test/api.test.js` (run with `npm test`) |
| Screenshots | `docs/screenshots/` |
| Deployment config | `netlify.toml` (Netlify + Supabase); steps in README → Deployment |

## Hosting note (live demo)

The live demo runs on **Netlify** (frontend + API function) with a **Supabase Postgres** database. Both are on free plans, so nobody pays for anything.
- Data is stored permanently in Supabase. Documents and shares survive refreshes, redeploys and restarts.
- The first request after idle time can take a few seconds while the function cold-starts.
- Supabase pauses free projects after about 7 days of inactivity. If the app reports that the database is unavailable, the project needs to be resumed from the Supabase dashboard.

## Test accounts (for the sharing flow)

All passwords are `password123`. The login page has one-click buttons for each account.

| User | Email |
|---|---|
| Alice Owner | alice@example.com |
| Bob Collaborator | bob@example.com |
| Carol Reviewer | carol@example.com |

**Quick review path (about 2 minutes):**
1. Sign in as Alice and create a document. Use bold, a heading and a list, then refresh: formatting is kept.
2. Click **Share**, add `bob@example.com` as *Can view*.
3. In a private window, sign in as Bob. The document is under **Shared with me** and is read-only.
4. As Alice, switch Bob to *Can edit*. Bob refreshes, edits, and Alice sees the change.
5. Click **Import file** with a `.docx`, `.md` or `.txt` file to get a new editable document.

## Status

**Working end to end:** login, create/rename/edit/delete, autosave with save status, rich-text formatting, persistence across refresh, `.txt`/`.md`/`.docx` import, sharing with view/edit roles (enforced on the server), owned vs shared lists, validation and error messages.

**Intentionally not built:**
- real-time co-editing
- export
- comments
- attachments
- sign-up and password reset
- session expiry
- invites for unregistered emails

**Known limitation:** if two editors edit the same document at the same time, the last save wins.

**Next 2-4 hours:**
1. Conflict detection: send a document version with each save, return 409 on mismatch, and show a "reload" prompt.
2. Session expiry and login rate limiting.
3. Export to `.docx` / `.md`.
4. Browser end-to-end tests committed and run in CI.
