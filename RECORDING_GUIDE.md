# IntellMeet Recording Guide

## Before recording

Configure `.env` with a working MySQL/TiDB `DATABASE_URL` and a unique `JWT_SECRET`, then apply the Drizzle migration and start the app as described in `README.md`. The ZIP does not include a verified hosted deployment, so do not use the old preview URL that may appear elsewhere in the original submission materials. Record from the HTTPS deployment only after you have deployed the updated code and tested its database-backed login flow.

## Suggested project demo: three to four minutes

1. **Authentication, 30 seconds.** Open `/register`, create a test account, and show that registration enters the dashboard. Sign out and sign back in at `/login`. Do not show the test password in the recording.
2. **Overview, 35 seconds.** Point to the metric cards. Explain that dashboard content is sample data and is currently intended to demonstrate the proposed workflow rather than live team telemetry.
3. **Meeting room interface, 50 seconds.** Join a sample meeting. Show the room drawer, microphone/camera controls, and sample summary/transcript. Explain that the room and AI content are prototype surfaces; no live video transport or external AI service is connected.
4. **Tasks and workspace, 35 seconds.** Open the workspace and task views. Toggle a sample action item and show the chat composer. Clarify that these interactions are client-side demo state.
5. **Meeting creation, 30 seconds.** Create a meeting and search for it. Refresh to demonstrate browser-local persistence.
6. **Analytics, 25 seconds.** Show the analytics view and explain that the charts and metrics are illustrative prototype data.
7. **Closing, 15 seconds.** Summarize the implemented login/session backend and note the next step: persist meeting, task, and message data server-side and connect real-time video/AI services if required by the rubric.

## Source-code submission

Submit the updated project ZIP or a Git repository containing the source, migration, README, and lockfile. Do not include `.env`, database credentials, `node_modules`, or any production secrets. The visible roadmap screenshot asks for source code/Figma and a live deployment URL; the deployment URL must point to a separate, working HTTPS host.

## Feedback video: one minute

> “While building IntellMeet, I focused on the transition from a meeting to its follow-up work. I added an email registration and login flow backed by bcrypt password hashes, MySQL account records, and signed session cookies. The dashboard demonstrates meeting, workspace, task, and analytics interactions, but most of that content is still prototype data in the browser. The next engineering milestone is to store those records per user and connect the room to live video and real-time services.”

## Local start

```bash
cd intellmeet
cp .env.example .env
# Edit .env with a working MySQL/TiDB URL and a unique JWT_SECRET.
pnpm install
pnpm db:push
pnpm dev
```

Use the local URL printed by the server and start at `/register`. Never record a production password, database credential, or session secret.
