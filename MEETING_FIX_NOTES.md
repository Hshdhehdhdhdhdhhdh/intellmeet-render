# Meeting room rebuild — what changed and why

## Why people's faces were missing
Found by reading the code and re-testing the old and new room side by side in real browsers:

1. **A guest with no working camera could not see ANYONE's video.** The old code only offered the tracks
   it already had, so a joiner without a camera negotiated an audio-only call and never received video.
   (Old build, test result: guest screen showed the host as 0x0 frames. New build: host visible at 640x360.)
2. **No TURN relay.** Only STUN servers were configured. People on mobile data (Jio/Airtel carrier NAT),
   office Wi-Fi or a different network cannot connect with STUN alone, so their video never arrives.
3. **Two people connecting at the same instant could deadlock** (both sent offers, nothing resolved).
4. **Media state was guessed from tracks** instead of being shared, so tiles could show an avatar over a
   live picture (or a live picture for a camera that was off).
5. **Pressing Join before the camera finished starting** announced "camera off / mic off" to everyone and
   never corrected it (found while testing the rebuilt room).

## What the new room does
* New WebRTC layer `client/src/lib/rtc.ts`: always negotiates audio+video both ways, collision-safe
  ("perfect negotiation"), ordered signalling, automatic ICE restart, TURN from `/api/ice`.
* New `client/src/components/LiveCall.tsx` + `meeting-room.css` (replaces the old room; same props, same page).
* Pre-join with camera/mic preview, device pickers, mic level meter, camera flip on phones.
* Grid / speaker view, active-speaker highlight, pin, auto-spotlight when someone presents.
* Mic/camera/hand state shared live; reactions; in-meeting chat; connection-quality bars.
* Screen sharing, live captions + transcript (feeds Meeting Intelligence), audio recording of the whole
  meeting (mixed) for AI notes.
* Host tools: admit/deny/admit-all, "let people in automatically" (Google-Meet-style open link),
  mute everyone, remove a participant, end for everyone, host hand-over when the host leaves.
* Adaptive bitrate/resolution as more people join; wake-lock on phones; keyboard shortcuts (M, V, H, C).
* Server: `server/signaling.ts` (state, reactions, captions, host controls) and `/api/ice` in `server/_core/index.ts`.

## IMPORTANT for deployment
* **Video calls need a server that keeps WebSocket connections open** (Manus hosting, Render, Railway,
  Fly.io, a VPS, or the included Dockerfile). **They do NOT work on Vercel** — Vercel serverless functions
  cannot hold sockets (the code deliberately disables signalling there).
* Signalling state lives in memory, so run **one** server instance (or add the Socket.IO Redis adapter to scale).
* Set TURN credentials (see `.env.example`) — free at metered.ca takes ~3 minutes. This is what makes
  calls work between phone-on-mobile-data and laptop-on-Wi-Fi.
* Mesh WebRTC (everyone connects to everyone) is smooth for about 6-8 people. Quality is automatically lowered
  as the room grows. For 20+ people the next step is an SFU such as LiveKit.

## How to test (2 minutes)
1. Open the meeting link on your laptop and join (you become host).
2. Open the same link on your phone using **mobile data** (not Wi-Fi) and join.
3. Admit the phone (or turn on "Let people in automatically"). Both faces should appear within a few seconds.
Automated check used during development: `python3 scripts/meeting-e2e.py` (needs `pip install playwright`
and a running server on port 3100).

## Verified in testing (real browsers + real MySQL-compatible database)
* All 8 database migrations apply; project auth + feature smoke tests pass (register, login, logout, profile,
  meeting create/list, AI summary saved to DB).
* Account flow: sign up -> create saved meeting -> host opens `/call/meeting--ID` (name prefilled) -> a guest
  with NO account opens the same link -> host admits -> audio AND video flow both ways
  (~420 audio packets with real audio energy and ~135 decoded video frames per direction in 9 s).
* Invalid meeting link shows "Meeting not found."
* Run it yourself: `python3 scripts/meeting-account-e2e.py` (see the script header for setup).

## AI settings on non-Manus hosts
`server/_core/llm.ts` now also works with any OpenAI-compatible API: set `BUILT_IN_FORGE_API_URL`,
`BUILT_IN_FORGE_API_KEY` and (optional) `LLM_MODEL`. Without a key, summaries/transcription show a clear
"AI service is not configured" message; calls, chat and everything else still work.

## Update: single host + faster connecting
* **Only the creator is host.** Saved meetings: the server gives a signed host token (`meetings.hostToken`)
  only to the signed-in owner; the socket server (`server/signaling.ts`, `server/hostToken.ts`) trusts only that
  token. Anyone opening the invite link is always a guest, even if they connect first. Unsaved rooms: the first
  browser to open the room holds a private key and is the only host. A host who refreshes/reconnects gets the
  role back; a guest is never auto-promoted. Guests who arrive before the host wait and are shown to the host
  as soon as the host joins. Opening a second tab as host keeps exactly one host.
* **Faster connecting.** Join is sent immediately (it no longer waits up to 10 s for the camera prompt/TURN
  list), TURN/STUN list is cached per session with a 2.5 s timeout, server TURN lookup has a timeout,
  dead-connection detection is quicker, and stale "recovered" sockets (a cause of double hosts) are gone.
* Tests: `server/hostAuthority.test.ts` (real sockets).
