# AI-Native Development Workflow

## Tools Used

I used AI tools as part of my development workflow to speed up implementation, improve code quality, and validate the application.

- **Claude Code** – Used inside VS Code as the primary agentic coding assistant. It generated code, executed shell commands, ran tests, integrated libraries, and automated browser-based checks.
- **ChatGPT** – Used as a supporting AI assistant for technical reasoning, exploring implementation approaches, debugging guidance, reviewing potential issues, and evaluating technical trade-offs.
- **Playwright + Headless Chrome** – Used for automated end-to-end testing across two independent user sessions.

No other AI coding tools were used.

## Where AI Materially Accelerated Development

### 1. Scaffolding and Boilerplate

Claude Code generated the initial application structure, including:

- Express backend routes and API endpoints.
- SQLite database schema.
- React components and application structure.
- CSS styling and basic UI layouts.

This significantly reduced repetitive implementation work and allowed more time to focus on business logic, permissions, security, and the document-saving workflow.

### 2. Library Integration

AI helped integrate and configure the following libraries:

| Library | Purpose |
|---|---|
| TipTap | Rich-text document editing |
| Mammoth | Converting `.docx` files into HTML |
| Marked | Converting Markdown into HTML |
| sanitize-html | Removing unsafe HTML elements and scripts |

It also helped handle formatting edge cases, including heading levels and formatting imported from external documents.

### 3. Test Writing

Claude Code helped translate sharing and access-control requirements into automated tests.

For example, it implemented lifecycle tests covering:

- Viewer access.
- Editor access.
- Permission upgrades.
- Access revocation.
- Preventing unauthorized users from accessing documents.

This made it faster to establish meaningful test coverage.

### 4. Browser Automation and Verification

Claude Code created a temporary Playwright script using Headless Chrome to simulate two independent users.

It automated the workflow where Alice creates and shares a document with Bob, while checking the expected permissions and editing behavior.

This reduced repetitive manual browser testing.

## AI Output I Changed or Rejected

I treated AI-generated code as a starting point rather than accepting every suggestion.

| AI-generated output or suggestion | My decision and reasoning |
|---|---|
| Latest package versions (Vite 7, better-sqlite3 12, marked 15, Playwright 1.5x) | Rejected incompatible versions because my local environment runs Node 18 and those versions require Node 20+. I pinned Node 18-compatible packages and used Node 20 in the Docker image. |
| Autosave retry logic reading React `status` state inside an async callback | Fixed a stale-closure bug. An outdated state value could cause an endless retry loop. I replaced it with a local `failed` flag so a failed save waits for user action or further typing. |
| Revoke-access test assuming Bob's ID was `owner.id + 1` | Rejected this fragile assumption and changed the test to retrieve Bob's actual ID from the owner's share list. |
| Inline SQL statement in the update route | Moved it into the shared prepared-statement map for consistency and to avoid preparing the same statement on every request. |
| `contentEditable` with deprecated `execCommand` | Rejected it because of inconsistent formatting behavior and chose TipTap for rich-text editing. |
| Replacing authentication with a user-selection dropdown | Rejected it because it would not properly validate real authentication and access-control behavior. |
| Returning HTTP 403 for inaccessible documents | Used HTTP 404 instead to avoid revealing whether a document exists to unauthorized users. |
| Serverless deployment target | Rejected serverless platforms such as Vercel and Netlify for this SQLite setup because it requires persistent storage. Chose a Docker-based host with a persistent volume instead. |

ChatGPT was also used as a supporting tool to reason through technical decisions and evaluate alternative approaches rather than simply accepting the first implementation suggested by AI.

## How I Verified Correctness, UX, and Reliability

### 1. Automated Tests

**10 automated tests passed successfully using `npm test`.**

Tests run against the real HTTP API with a fresh in-memory database for each test, without mocking the application API.

Coverage includes:

- Authentication.
- Formatting round-trip.
- Title validation.
- XSS sanitization.
- Complete document-sharing lifecycle.
- Permission boundaries.
- Markdown (`.md`) import.
- Text (`.txt`) import.
- Word (`.docx`) import.

The DOCX import test uses a real Word document generated with `python-docx`, rather than a mock.

### 2. End-to-End Browser Testing

I used Playwright with Headless Chrome to test the application using two separate user sessions.

The following scenarios were verified:

- Alice formats a document, reloads the page, and gets the same HTML content back.
- Alice shares a document with Bob as a viewer.
- Bob sees the document under **Shared with me**, but cannot edit it.
- Alice upgrades Bob's permission to editor.
- Bob edits the document, and Alice can see the updated content after reloading.
- Markdown import produces a properly formatted document.
- Unsupported PDF imports and sharing with an unknown email display clear error messages.

### 3. Visual Review

I reviewed browser screenshots of the different application states, stored in `docs/screenshots/`.

I checked:

- Owner and shared-document labels.
- View-only and editable states.
- Save-status indicators.
- General UI consistency.

### 4. Manual Code Review

I personally reviewed the security-critical areas instead of relying only on AI-generated tests.

Particular attention was given to:

- Authentication and authorization checks.
- Document ownership and sharing permissions.
- Access revocation.
- HTML sanitization allow-list.
- Unauthorized document access behavior.

I specifically reviewed the permission checks in `backend/src/app.js` because mistakes in this area could create security vulnerabilities.

## AI Usage Principle

My approach throughout development was:

**AI generates the first draft; I take responsibility for the final implementation.**

I used AI to reduce repetitive coding, accelerate integration, improve test coverage, and explore solutions. However, I independently evaluated important technical decisions, corrected incorrect suggestions, and verified the final behavior through automated tests, browser testing, and manual code review.

AI accelerated the development process, but correctness, security, and reliability remained my responsibility.
