# Architecture & Technical Decisions

## 1. Design Priorities

The application was designed around four key priorities:

### 1.1 Core Document Editing Experience

The primary focus was to make the document editing workflow reliable:

**Create → Edit → Format → Autosave → Refresh → Content Persists**

Key considerations:

- A proper rich-text editing engine.
- Visible save-status indicators.
- Automatic saving with retry handling.
- Warning users before leaving with unsaved changes.
- Preserving document formatting after page reloads.

This workflow received the highest priority because it represents the first and most important experience for a reviewer.

### 1.2 Server-Side Access Control

Access control is enforced at the API level rather than relying only on frontend visibility.

The frontend hides actions that users are not allowed to perform, but the backend independently validates every request.

This ensures that permissions remain enforced even when someone attempts to access an API endpoint directly.

### 1.3 Secure Content Rendering

Shared documents can contain HTML that is rendered in another user's browser.

To prevent XSS and unsafe markup, all incoming HTML passes through a centralized allow-list sanitizer.

This applies to both:

- Content submitted through the rich-text editor.
- Content imported from external files.

### 1.4 Simple Deployment and Setup

The application uses a lightweight architecture:

- One Express app, run as a normal Node server locally and as a single Netlify Function in production.
- One PostgreSQL schema: Supabase in production, embedded PGlite locally (no database install needed).
- No external authentication provider required.
- Free hosting (Netlify + Supabase), with no card required for the author or reviewers.

This keeps local setup straightforward and makes deployment easier.

---

## 2. Key Architectural Decisions

### 2.1 Rich-Text Editor: TipTap / ProseMirror

**Decision:** Use TipTap instead of native `contentEditable` with `execCommand`.

**Reasoning:**

- `execCommand` is deprecated.
- Browser implementations can produce inconsistent HTML.
- TipTap provides a structured document model.
- Supports undo/redo and keyboard shortcuts.
- Produces more predictable HTML output.

**Trade-off:** TipTap introduces an additional dependency, but provides a more reliable editing experience and better control over document formatting.

### 2.2 Document Storage: HTML Instead of ProseMirror JSON

**Decision:** Store sanitized HTML in the database.

**Why HTML?**

- Mammoth converts DOCX files into HTML.
- Marked converts Markdown files into HTML.
- The sanitizer already operates on HTML.
- HTML is readable and easy to inspect directly in the database.

The editor schema and server-side allow-list restrict content to a known set of supported tags.

**Trade-off:**

HTML storage is suitable for the current editing and import requirements, but is not the ideal foundation for real-time collaborative editing.

If collaborative editing becomes a requirement, I would move toward a ProseMirror JSON or Y.js-based document model with CRDT synchronization.

### 2.3 Database: PostgreSQL (Supabase) with PGlite for local and tests

**Decision:** Use PostgreSQL. Production uses a managed Supabase database. Local development and tests use **PGlite**, the Postgres engine compiled to WebAssembly and running inside the Node process.

**Why PostgreSQL?**

- Transactional database operations and foreign keys.
- `ON DELETE CASCADE` automatically cleans up associated sharing and session records.
- Supabase's free tier gives a persistent, managed database without a credit card.
- Serverless functions have no persistent disk, so the database must live outside the app.

**Why PGlite locally?**

- Reviewers can run the project with `npm start` and no database installation.
- Tests run the exact same SQL as production against a real Postgres engine, with a fresh in-memory instance per test and no mocks.

All database access goes through a small `query(text, params)` interface (`backend/src/db.js`), so the app code is identical for Supabase and PGlite.

**History:** the first version used SQLite. I moved to Postgres when deploying, because the free hosts that keep a persistent disk required card verification, and serverless hosting needs an external database.

**Trade-off:**

There is a network round trip to the database on every request, and free Supabase projects pause after about a week of inactivity. In return, data is durable and the app can scale horizontally without changing the storage layer.

### 2.4 Document Sharing and Permissions

**Data model:**

Each document has one owner through `owner_id`.

Additional access is managed through:

`document_shares(document_id, user_id, role)`

Supported roles:

- `viewer`
- `editor`

**Permission rules:**

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| View document | Yes | Yes | Yes |
| Edit title and content | Yes | Yes | No |
| Share document | Yes | No | No |
| Change user roles | Yes | No | No |
| Revoke access | Yes | No | No |
| Delete document | Yes | No | No |

**Security decision:**

Unauthorized users receive HTTP `404` instead of `403`.

This avoids revealing whether a document exists when the requester has no access.

Sharing is currently limited to registered users. Pending invitations are not supported.

### 2.5 Authentication and Session Management

**Decision:** Implement lightweight authentication for the demo application.

The authentication flow works as follows:

1. Demo users are seeded with bcrypt-hashed passwords.
2. Users authenticate with their credentials.
3. The server generates a cryptographically random 256-bit bearer token.
4. The token is stored in the `sessions` table.
5. The client stores the token in `localStorage`.
6. Subsequent API requests use the token to identify the authenticated user.

This was chosen instead of a simple user-selection dropdown because each request carries an actual authenticated identity, allowing meaningful permission enforcement.

**Current limitations:**

- Sessions do not expire.
- Login rate limiting is not implemented.
- No self-service registration.
- No password-reset functionality.

This implementation is suitable for the assessment scope, but additional security controls would be required before production use.

### 2.6 File Import Pipeline

**Decision:** Process document imports on the server and convert them into sanitized HTML.

Supported formats:

- `.docx` – Converted using Mammoth.
- `.md` – Converted using Marked.
- `.txt` – HTML-escaped to preserve plain-text content safely.

**Import workflow:**

File Upload → Format Detection → HTML Conversion → Sanitization → New Document Creation

Additional safeguards:

- In-memory file handling.
- 4 MB upload limit. Netlify Functions accept about 6 MB per request, and file uploads arrive base64-encoded (+33%).
- File-extension allow-list.
- Centralized HTML sanitization.

Plain-text content is HTML-escaped, so HTML-like strings such as `<b>` remain literal text rather than being interpreted as markup.

### 2.7 Autosave and Save Pipeline

**Decision:** Use debounced autosaving with controlled request handling.

The save pipeline works as follows:

1. Changes are collected for 1 second before saving.
2. At most one PATCH request remains in flight.
3. If the user continues editing during a save, the latest changes are queued for the next request.
4. If saving fails, the failed payload is retained instead of being silently discarded.
5. The user can retry or continue editing.

**Concurrency strategy:**

The current implementation uses last-write-wins behavior.

This is acceptable for the assessment scope, but simultaneous editing by multiple users can overwrite earlier changes.

Optimistic locking is a planned improvement.

### 2.8 Deployment: Netlify + Supabase

**Decision:** Host the static React build on Netlify and run the Express API as a single Netlify Function. Store data in Supabase Postgres.

- The Express app is wrapped with `serverless-http`. A small middleware maps `/.netlify/functions/api/*` back to `/api/*`, so routes are identical everywhere.
- esbuild bundles the function into one self-contained file during the Netlify build (`npm run build:netlify`).
- The Supabase connection uses the transaction pooler with prepared statements disabled, which suits short-lived serverless connections.
- Tables and demo users are created automatically on first start, so there is no manual database setup.

**Trade-off:** serverless functions add cold-start latency, and the 4 MB upload limit comes from Netlify's request size cap. Both are acceptable for this scope.

---

## 3. Testing Strategy

The application is designed to be testable without mocking the core HTTP behavior.

The `createApp(db)` function accepts a database instance as a parameter.

This allows each test to:

- Create a fresh in-memory Postgres database (PGlite).
- Run requests through the actual HTTP application.
- Verify real API behavior.
- Avoid dependencies on a shared test database.

Testing focuses on the highest-risk areas:

- Authentication and authorization.
- Permission boundaries.
- HTML sanitization.
- Document import and conversion.
- Document-sharing lifecycle.

Additionally, I used Playwright with Headless Chrome during development to verify the complete two-user workflow.

For deployment, I bundled the Netlify Function exactly as the build does, ran it from an empty folder (no `node_modules`) against a networked Postgres server, and sent Netlify-style events. This covered login, sharing, permission errors, a base64-encoded `.docx` upload and the upload size limit.

The browser automation script was temporary and was not committed to the repository to keep the project dependencies lightweight.

---

## 4. Known Limitations and Future Improvements

The following improvements were identified during development.

| Area | Current limitation | Planned improvement |
|---|---|---|
| Concurrent editing | Last-write-wins can overwrite another editor's changes. | Add optimistic locking using document versions or `updated_at`, return HTTP 409 on conflicts, and show a reload prompt. |
| Real-time collaboration | No live synchronization between editors. | Introduce Y.js and CRDT-based synchronization. |
| Session security | Sessions do not expire. | Add session expiration and lifecycle management. |
| Login security | No login rate limiting. | Introduce rate limiting and additional authentication protections. |
| User management | No registration or password recovery. | Add sign-up and password-reset workflows. |
| Document sharing | Only registered users can receive access. | Add pending invitations for unregistered email addresses. |
| File management | Import is supported, but export and attachments are not. | Add document export and attachment support. |
| Free-tier hosting | Function cold starts add a few seconds after idle time, and Supabase pauses free projects after about 7 days without activity. | Use a paid tier or a scheduled keep-alive for a production deployment. |

---

## 5. Final Architecture Rationale

The architecture prioritizes reliability, security, simplicity, and maintainability over unnecessary infrastructure complexity.

Each major decision was made according to the current product requirements:

- TipTap provides a reliable rich-text editing experience.
- HTML provides a practical storage format for editing and document imports.
- PostgreSQL (Supabase in production, PGlite locally) gives durable data with zero local setup.
- Server-side authorization protects document access.
- Centralized sanitization reduces XSS risks.
- Controlled autosaving protects user changes.
- Automated and browser-based tests validate the actual application behavior.

The implementation deliberately keeps the architecture simple while identifying clear upgrade paths for production requirements such as concurrent editing, session security, and horizontal scaling.
