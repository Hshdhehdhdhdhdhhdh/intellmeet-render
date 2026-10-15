# IntellMeet — AI Meeting Workspace
**Live Deployment:** https://intellmeet-cqap.onrender.com

**Backup (Manus):** https://intellmeet2-mnkjmg3p.manus.space

IntellMeet is a React + TypeScript meeting workspace with a Node/Express and tRPC backend. The dashboard includes meeting, workspace, task, calendar, and analytics demo interactions. Email/password registration and login are implemented against MySQL/TiDB with bcrypt password hashing and signed HTTP-only JWT session cookies.

## Run locally in VS Code

### Fastest path (Docker Desktop)

Install Node.js 22+, pnpm, and Docker Desktop. Open this folder in VS Code, open the integrated terminal, and run:

```bash
pnpm setup
pnpm dev
```

The setup command creates `.env`, installs dependencies, starts the bundled MySQL 8.4 container, and applies the Drizzle migration. Open `http://localhost:3000/register` and create an account. You can also use **Run and Debug → IntellMeet: dev server** after setup.

To stop or inspect the local database:

```bash
pnpm db:stop
pnpm db:logs
```

### Manual path (existing MySQL/TiDB)

1. Install Node.js 22+ and pnpm, then install dependencies:

   ```bash
   pnpm install
   ```

2. Create a MySQL database named `intellmeet`, copy `.env.example` to `.env`, and set `DATABASE_URL` to the connection string for your database. Replace `JWT_SECRET` with a unique random value of at least 32 characters. You can generate one with:

   ```bash
   openssl rand -base64 48
   ```

3. Generate and apply the Drizzle migration:

   ```bash
   pnpm db:push
   ```

4. Start the app:

   ```bash
   pnpm dev
   ```

   Open `http://localhost:3000/register`, create an account, and verify that you land on the dashboard. Sign out from the profile menu, sign back in at `/login`, and confirm `/` redirects to login when signed out.

   With the app running and a configured database, you can also exercise the HTTP auth flow with a disposable test account:

   ```bash
   AUTH_SMOKE_URL=http://127.0.0.1:3000 node scripts/auth-smoke.mjs
   ```

The Docker setup is for local development only. Change `JWT_SECRET` and use a managed database before deployment.

## Meeting scheduling

The meeting dialog now uses selectable date, start-time, and duration inputs. The Calendar page has a date picker, weekday selection, and previous/next week controls. Meeting records created by a signed-in user are stored per account in the MySQL/TiDB `meetings` table through tRPC and Drizzle. The no-login `/demo` route continues to save demo-created meetings in that browser's local storage. Apply the Drizzle migration with `pnpm db:push` after setting `DATABASE_URL`.

## Authentication/backend

- `auth.register` validates name/email/password, normalizes the email, hashes passwords with bcrypt (12 rounds), stores account/profile records in one transaction, and signs the session cookie.
- `auth.login` verifies the password against the stored bcrypt hash and refreshes `lastSignedIn`.
- `auth.me` resolves the current user from the signed cookie; `auth.logout` clears it.
- `meetings.list` reads only the signed-in account's meetings; `meetings.create` accepts a non-empty title, a future UTC ISO timestamp, and a 15–240 minute duration. The owner is always taken from the authenticated session, never from request data.
- Account/profile persistence uses the existing Drizzle MySQL/TiDB database. Both `DATABASE_URL` and a 32+-character `JWT_SECRET` are required for email/password auth.
- Passwords are limited to 72 characters because bcrypt only considers the first 72 bytes. Use HTTPS in production; cookies are HTTP-only and Secure for HTTPS requests.

## Validate

```bash
pnpm check
pnpm test
pnpm build
```

## Deployment checklist

The permanent Manus deployment uses the root `Dockerfile`, the managed MySQL-compatible database, managed object storage, project-scoped OAuth/session credentials, speech transcription, and managed LLM APIs. Runtime credentials are injected by the platform and are never stored in this repository. For a different host, provide equivalent MySQL, object-storage, speech, and OpenAI-compatible services, apply all Drizzle migrations, and keep secrets outside source control.

## Known prototype behavior

Signed-in meetings, their email-based room invitations, profiles, support requests, Copilot upload metadata, transcripts, summaries, key decisions, and meeting action items are backed by the managed database and storage/AI APIs. `/demo` intentionally keeps sample meetings and its generated insights in browser/session state. Workspace chat, task boards, analytics figures, demo invitations, and reports remain interactive prototype data rather than account-scoped team records. Signed-in invitations grant room access after the owner shares the join link manually; the app does not send invitation emails. WebRTC and Socket.IO signaling are implemented, but a multi-device media call and TURN relay are still deployment-dependent. Automatic transcription is supported for WebM, MP3, WAV, OGG, and M4A recordings under 15 MB; unsupported or silent audio returns a clear validation error.

## Live demo

- Public demo (no account required): `/demo`
- Registration: `/register`
- Login: `/login`
- Live HTTPS site: see the permanent publication URL delivered with this release.

## Zidio F-01 to F-07 coverage

| ID | Capability | In this build |
|---|---|---|
| F-01 | Authentication and profiles | Email/password signup/login with bcrypt, project-scoped HTTP-only session cookies, authenticated profile editing, logout, protected routes, and per-user records. |
| F-02 | Real-time video meetings | The call UI, browser WebRTC path, and mounted Socket.IO signaling endpoint at `/api/socket` are present. Browser media permission is required; a multi-device call was not verified in this environment, and no TURN relay is configured. |
| F-03 | AI meeting intelligence | Managed speech transcription plus generated summaries, key decisions, and action items. Signed-in meeting intelligence is persisted and reloadable; generated action items can be added to Tasks. Copilot answers general questions, uses workspace context, analyzes uploaded files, and runs supported UI actions. |
| F-04 | Chat and collaboration | Workspace and in-room chat interfaces are present; Socket.IO has a room chat event. Workspace chat and account-scoped team collaboration are not backed by persistent database records. |
| F-05 | Post-meeting dashboard | Past meetings, summaries, action items, analytics, and report download are present as workspace views. |
| F-06 | Team and project management | Signed-in meeting owners can save email-based room invitations; invited accounts can join after receiving the link manually. Workspace member/task/Kanban views remain browser-state prototype features. |
| F-07 | Analytics and insights | Charts, collaboration metrics, and exportable workspace report. Figures are illustrative prototype data. |

This is a functional full-stack prototype on React 19, TypeScript, Vite, Express, tRPC, Drizzle, and MySQL/TiDB. It is not a Kubernetes/MongoDB/WebRTC production replica of the Zidio industry brief.


## September 2026 functional repair

This version preserves the existing IntellMeet UI and adds production-ready behavior to the meeting and Copilot flows.

- The **Start a new meeting** dialog uses readable dark native controls for date, start time, and duration, validates future scheduling, and saves signed-in meetings to MySQL. The `/demo` route keeps meetings in browser storage.
- **IntellMeet Copilot** answers general questions, understands the current meeting and task context, runs supported workspace actions, and accepts up to five files per request (15 MB each).
- Text-like files are extracted on the server. Images, PDFs, MP3, WAV, M4A/audio MP4, and MP4 video are passed to the managed multimodal model through short-lived signed storage URLs. Other binary formats remain stored and return a clear format limitation.
- Uploaded bytes live in managed object storage. Ownership and file metadata live in the managed MySQL database.
- The production server exposes `GET /api/health`, uses `webdev_app_session`, validates project-scoped sessions, and marks API responses `private, no-store`.
- **Authentication and profile:** registration, login, session refresh, logout, protected per-user meeting data, and `/profile` name updates are all backed by validated APIs.
- **Support:** `/support` contains practical help and a validated request form persisted to `support_tickets`.
- **Meeting intelligence:** meeting recordings or uploaded WebM/MP3/WAV/OGG/M4A files are transcribed by the managed speech API. The editable transcript is converted to a factual summary, key decisions, and structured action items by the managed LLM. Signed-in meeting results persist in `meeting_insights` and reload on the meeting.
- **Invitations and signaling:** meeting owners can save invitations to registered email addresses via `meetings.invite`; a signed-in invitee can join the private room using the manually shared link. Socket.IO checks ownership/invitation, derives account names from the verified session, and rejects cross-room signaling and chat.
- **Meeting lifecycle:** `meetings.list`, `meetings.create`, `meetings.join`, `meetings.cancel`, and `meetings.invite` expose authenticated lifecycle behavior. Saved meetings keep title/description, start time, derived end time, deterministic room ID, and scheduled/live/completed/cancelled status. Host cancellation and invalid/completed/cancelled join attempts are rejected server-side.
- **Project progress:** the complete 21–28 September architecture, authentication, meeting, dashboard, meeting-room, collaboration, and WebRTC implementation history is documented in `DEVELOPMENT_TIMELINE.md` and summarized in `MENTOR_UPDATE.md`.

### Managed runtime requirements

The application reads `DATABASE_URL`, `MANUS_API_URL`, `MANUS_API_KEY`, `MANUS_PROJECT_ID`, `MANUS_JWT_SECRET`, `MANUS_OAUTH_API_URL`, and `MANUS_OAUTH_PORTAL_URL` from the managed Webdev runtime. Legacy `BUILT_IN_FORGE_*`, `VITE_APP_ID`, `JWT_SECRET`, and `OAUTH_SERVER_URL` names remain fallback-compatible for older local environments. Never place real secret values in the repository.

### Verification

```bash
pnpm install --frozen-lockfile
pnpm exec drizzle-kit migrate
pnpm check
pnpm test
pnpm build
PORT=3000 pnpm start
```

The managed publication uses the root `Dockerfile` for the API/server and `dist/public` for static SPA assets. `/api/*` routes go to the container; hashed `/assets/*` files are immutable static assets; other page routes use the static SPA fallback.
