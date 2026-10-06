# IntellMeet: AI Meeting and Collaboration Workspace

**Project owner:** Shubham Singh
**Project type:** Full-stack web application
**Stack:** React 19, TypeScript, Vite, Node.js 22, Express, tRPC, Drizzle ORM, MySQL/TiDB, Socket.IO, WebRTC
**Status as of 29 September 2026:** Core frontend, backend, authentication, profile, support, meeting management, transcription, AI meeting intelligence, storage, database, and API connectivity are implemented and verified. The final live address is supplied separately in the release handoff.

## 1. Summary

IntellMeet brings meeting scheduling, live browser calls, recordings, transcription, AI summaries, key decisions, action items, Copilot, tasks, analytics, reports, profile management, and support into one preserved dark workspace UI. The React client communicates with the Express server through typed tRPC procedures. Server-side validation and authenticated ownership protect per-user records.

## 2. Implemented feature status

| Area | Implemented behavior | Persistence / boundary |
|---|---|---|
| Registration and login | Normalized email, bcrypt password hash, secure project-scoped session cookie, `auth.me`, logout, protected routes. | Users and local accounts persist in MySQL. |
| Profile | `/profile` displays the authenticated account and updates the meeting/display name through `auth.updateProfile`. | Name update persists per user. Email is read-only in the profile UI. |
| Support | `/support` provides FAQs and a validated category/name/email/message request form. | Requests persist in `support_tickets`. |
| Meeting management | Create/list signed-in meetings with title, description, start/end derivation, duration, deterministic room IDs, future validation, calendar views, detail drawer, host cancellation, and validated join flow. | Signed-in meetings persist per owner with scheduled/live/completed/cancelled lifecycle. Demo meetings stay in local storage by design. |
| Meeting interface | WebRTC camera/microphone peers, offer/answer/ICE signaling, Socket.IO room events, screen sharing, local recording, copyable join links, controls, leave/cleanup, and room chat interface. | Private rooms accept only owners or saved email invitees; cross-room signaling is blocked. TURN and two-network media validation remain deployment dependent. |
| Transcription | Recording/upload validation, durable object storage, managed Whisper-compatible transcription, detected language, transcript editor. | Supported inputs: WebM, MP3, WAV, OGG, M4A; maximum 15 MB. |
| AI meeting intelligence | Transcript-to-summary, key decisions, and structured action items using strict JSON output. Generated actions can be added to Tasks. | Signed-in meeting insights persist/reload from `meeting_insights`; demo insights stay in UI state. |
| Copilot | General answers, workspace context, safe navigation/search/meeting/task/report actions, pending/failure states, and up to five 15 MB attachments. | Upload bytes use object storage; metadata uses MySQL. Text/image/PDF/audio/video analysis is supported where the model accepts the format. |
| Workspace | Meetings, task board, chat, team invite flow, analytics, reports, and calendar remain interactive. | Signed-in meeting invitations are saved and grant room entry; no email is sent. Chat, demo invites, tasks, analytics values, and reports remain prototype/browser-state modules. |

## 3. Architecture

- **Frontend:** React/Vite SPA under `client/`, with routes for login, registration, demo, profile, support, calls, and the protected dashboard.
- **API:** Express plus tRPC under `/api/trpc`; Socket.IO signaling under `/api/socket`; unauthenticated health check at `/api/health`.
- **Authentication:** Local account registration/login with bcrypt; project-scoped HTTP-only session JWT; account ownership derived on the server.
- **Database:** Drizzle schemas for `users`, `local_accounts`, `meetings`, `meeting_invitations`, `copilot_files`, `meeting_insights`, and `support_tickets`.
- **Storage:** Managed object storage for Copilot attachments and meeting recordings. Model access uses short-lived signed URLs where required.
- **AI:** Managed chat-completions models for Copilot and structured meeting intelligence; managed Whisper-compatible endpoint for speech transcription.
- **Deployment:** Static Vite assets plus a Node container backend. `/assets/*` is immutable; HTML is revalidated; API responses are `private, no-store`.

## 4. API overview

| Router | Main procedures |
|---|---|
| `auth` | `register`, `login`, `me`, `logout`, `updateProfile` |
| `meetings` | `list`, `create`, `cancel`, `join`, `invite` |
| `meetingIntelligence` | `get`, `transcribe`, `analyze` |
| `copilot` | `upload`, `ask` |
| `support` | `create` |
| `system` | `notifyOwner` |

## 5. Verification

- TypeScript: `pnpm check` passed.
- Tests: `pnpm test` passed, 17 tests across 6 files.
- Production compilation: `pnpm build` passed for client and server.
- Managed database: migrations through `0006_meeting_invitations.sql` applied.
- Authentication/meetings: registration, session, profile lookup, signed-in meeting creation/listing, duplicate rejection, wrong-password rejection, successful login, and logout passed via real HTTP requests.
- Copilot: durable text upload plus managed AI file analysis returned the expected answer.
- Meeting intelligence: managed AI returned a summary, decisions, and action items; the result persisted and reloaded for the signed-in meeting.
- Transcription: a real WAV speech sample returned the expected managed transcript.
- Support/profile: authenticated profile update and database-backed support request passed.
- Invitation/signaling: an uninvited account was rejected, the owner granted access by email, the invitee joined, verified names were enforced, and cross-room signaling was rejected.
- Meeting lifecycle: persisted descriptions/status, derived start/end values, deterministic saved-room IDs, host cancellation, cancelled/completed join rejection, and frontend Cancel controls are implemented and migration-backed.
- Preview UI: core pages returned HTTP 200; meeting dialog, native duration options, and Copilot controls were browser-verified.

## 6. Run locally

```bash
pnpm setup
pnpm dev
```

Or configure an existing MySQL/TiDB database from `.env.example`, then run:

```bash
pnpm install --frozen-lockfile
pnpm exec drizzle-kit migrate
pnpm dev
```

Managed AI, storage, speech, and OAuth/session behavior requires the corresponding server-side runtime variables documented in `README.md`.

## 7. Remaining boundary

IntellMeet is a substantial functional full-stack prototype, not a claim of a globally scaled enterprise conferencing system. A production rollout should add a TURN service for difficult WebRTC networks, multi-device media testing, moderation/retention policy, outgoing invitation email delivery, and account-scoped persistence for team chat, task boards, analytics events, and reports if those modules must become full multi-user systems.

## 8. Dated delivery scope

The requested 21–28 September implementation history, including architecture setup, authentication, meeting creation and lifecycle, dashboard/navigation, meeting-room foundation, collaboration/chat, and WebRTC camera/microphone work, is recorded in `DEVELOPMENT_TIMELINE.md`. The deployed database is MySQL/TiDB-compatible through Drizzle rather than MongoDB; this is the actual configured production architecture.
