# Files changed in the meeting-room fix (13 files)

## NEW files (3)
| File | What it does |
|---|---|
| client/src/lib/rtc.ts | New WebRTC engine: audio+video always negotiated both ways, collision-safe connections, TURN from /api/ice, auto reconnect, connection-quality stats |
| client/src/components/meeting-room.css | Styles for the new meeting room (desktop + phone) |
| MEETING_FIX_NOTES.md | What was wrong, what was fixed, how to deploy and test |

## REPLACED / EDITED files (8)
| File | Change |
|---|---|
| client/src/components/LiveCall.tsx | Fully rebuilt meeting room: join screen with camera/mic preview, video grid, speaker view, screen share, chat, hand raise, reactions, captions, recording, host controls |
| client/src/pages/CallPage.tsx | Passes live transcript to Meeting Intelligence |
| client/src/components/MeetingIntelligence.tsx | Accepts the live transcript from the call |
| server/signaling.ts | Shares mic/camera/hand state, reactions, captions, auto-admit, mute-all, remove person, host id |
| server/_core/index.ts | New /api/ice endpoint (TURN servers so calls work across networks) |
| server/_core/env.ts | New LLM_MODEL setting |
| server/_core/llm.ts | AI calls now also work with any OpenAI-compatible API |
| .env.example | Documents DATABASE_URL, JWT_SECRET, TURN settings and AI settings |

## Test scripts (2, optional)
| File | What it does |
|---|---|
| scripts/meeting-e2e.py | Automated 3-person call test |
| scripts/meeting-account-e2e.py | Automated account + guest + audio/video test |
