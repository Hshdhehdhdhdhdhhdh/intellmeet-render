# IntellMeet meeting-room replacement plan

## Scope and product decisions

Replace only the unreliable live-meeting/joining surface. Keep the existing transcription, decisions, action items, meeting intelligence, AI copilot, workspace, authentication, saved meetings, invitations, and supporting data/API behavior intact. Preserve the existing WebRTC + Socket.IO architecture rather than introducing a new vendor dependency, but make the room lifecycle explicit and resilient: pre-join device check, named join, host role, waiting requests, admission, peer cleanup, chat, media controls, recording, and leave/end actions.

The room will use a **host-led studio** pattern: a clear top status bar, a responsive video stage that expands with the participant count, a persistent right-side collaboration rail for chat/people/admissions, and a compact bottom control dock. Guests can enter their own name and wait for the host. Hosts can copy the share link from one prominent action and admit or deny guests from the same room rail. Participant count is not capped in application state; the grid uses CSS auto-fit and remains usable as it grows.

## Design direction

- **Design movement:** dark editorial product design with a calm broadcast-studio feel: high-contrast surfaces, soft violet/teal light, and restrained motion.
- **Core principles:** clarity before chrome; visible state for every live action; generous video-first space; progressive disclosure for chat, people, and host controls.
- **Color philosophy:** near-black navy grounds the room, electric mint marks healthy live state and primary actions, violet adds focus and intelligence, and coral is reserved for destructive or muted states.
- **Layout paradigm:** asymmetric stage-and-rail composition rather than a centered card grid. The stage owns the viewport; the rail is a stable collaboration edge; the dock anchors controls.
- **Signature elements:** live pulse indicator, glassy control dock, participant tiles with gradient identity rings and explicit name/status labels.
- **Interaction philosophy:** every action gives immediate visual feedback and an unobtrusive toast/status update; no control relies on emoji-only labels; destructive leave/end actions are visually separated.
- **Animation:** 160–220ms opacity/translate transitions for panels and toasts, subtle live pulse, no looping movement on video tiles, and reduced-motion-safe fallbacks.
- **Typography system:** existing DM Sans for compact UI copy with Manrope for page/room headings; strong numeric and status hierarchy, readable 12–14px body copy in the room.
- **Brand essence:** IntellMeet turns live conversation into accountable progress; calm, intelligent, dependable.
- **Brand voice:** direct and reassuring. Example lines: “You’re ready when the room is.” and “Everyone sees the same conversation, in real time.”
- **Wordmark & logo:** preserve the existing IntellMeet mark and supplied icon asset; use the mint mark as the live-room anchor rather than introducing a new logo.
- **Signature brand color:** luminous mint `#6CE4DF`.

## Project structure

- `client/src/components/LiveCall.tsx`: the replacement meeting room, pre-join, waiting room, media controls, peer tiles, host admission, and in-room chat.
- `client/src/pages/CallPage.tsx`: room route, access check, and composition with the preserved `MeetingIntelligence` panel.
- `client/src/pages/Home.tsx`: preserved dashboard, meeting creation, link sharing, invitations, and entry points.
- `server/signaling.ts`: Socket.IO room validation, host election, waiting-room admission, signaling relay, chat relay, and cleanup.
- `server/routers.ts`, `server/db.ts`, `server/meetingIntelligence.ts`: preserved meeting persistence and intelligence APIs.
- `client/src/index.css`: room-specific responsive layout and visual system, with existing non-room styles retained.
- `client/public/manus-routes.json`: complete page route manifest.

## Implementation notes

Use the existing socket protocol and add explicit deny support and a robust host/guest lifecycle. Keep room IDs validated on the server. Stabilize peer connection creation, track replacement, ICE candidate queuing, and cleanup. Ensure the host can share the exact room URL and that copied-link feedback is reliable even when Clipboard API permissions are unavailable. Keep meeting intelligence rendered alongside the room on `CallPage` so recording uploads and transcript/decision/action generation are unchanged.
