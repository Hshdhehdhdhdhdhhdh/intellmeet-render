# IntellMeet Submission Checklist

## What the supplied roadmap screenshot shows

The visible part of the screenshot shows two of five roadmap deliverables. **Source Code / Figma** is worth 5 marks and accepts a GitHub/GitLab repository or a Drive/Dropbox folder containing the project; UI/UX submissions may use a Figma link. **Live Deployment** is worth 5 marks and asks for a public URL where the project is hosted and running. The other three deliverables are below the visible area, so their names and requirements cannot be verified from this screenshot. Capture or open the rest of the roadmap before submitting so no hidden checklist item is missed.

## Visible deliverables

### 1. Source code / Figma — source is prepared

The updated source ZIP contains the application, auth UI and API, bcrypt dependency, migration, README, project report, QA notes, and this checklist. Upload the ZIP or a Git repository to the submission platform and attach its share/repository link. Do not include `.env`, production credentials, or `node_modules`.

### 2. Live deployment — not yet complete

No hosting account, production MySQL/TiDB URL, or deployment secrets were provided in the archive/session. A public deployment has therefore not been created or tested. Do not submit the old preview URL in the archive as proof of the updated build unless you independently confirm it shows this updated version.

To deploy the current code, choose a Node.js host that runs the Express server and a MySQL/TiDB service. Configure `DATABASE_URL`, a unique `JWT_SECRET` (at least 32 bytes), and `NODE_ENV=production` as host-side secrets. Install with `pnpm install --frozen-lockfile`, build with `pnpm build`, apply the migration with `pnpm db:push`, then start with `pnpm start`. Use the host’s HTTPS URL. From a private browser session, verify registration, duplicate-email rejection, sign-out, signed-out redirect, valid login, incorrect password feedback, and session persistence after refresh. The deployed app does not count as verified until those checks pass.

## Technical alignment and remaining product work

The source archive does **not** use MongoDB. It is built on the included Drizzle + MySQL/TiDB backend, and the new email/password auth stores accounts in that database. If the assignment specifically requires MongoDB, confirm with the instructor whether MySQL/TiDB is acceptable before relying on this implementation; switching databases is a separate engineering change.

The current meeting, chat, task, transcript, analytics, and AI copilot surfaces are predominantly prototype interactions and sample data. This source does not implement live WebRTC meetings, Socket.IO collaboration, real OpenAI processing, automatic audio transcription, or server-persisted per-user meeting records. Those items may matter if they appear in the full assignment rubric. Do not claim them as completed production features in a demo or report.

The full list of five platform deliverables is unknown because the supplied screenshot only shows items one and two. Review the remaining three items in the submission platform and match each one to a concrete file, URL, or recording before final submission.

## Recommended final checks

Before submission, complete the remaining roadmap inspection, upload the source ZIP or repository, deploy and test the full-stack app with a real database, replace any stale preview URL in the submission materials, and submit only an HTTPS deployment that shows the updated login and registration flow. Keep a copy of the deployment test results and confirm that the report does not overstate the prototype features.
