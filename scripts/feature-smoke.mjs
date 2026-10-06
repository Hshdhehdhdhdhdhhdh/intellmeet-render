import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.FEATURE_SMOKE_URL ?? "http://127.0.0.1:3000";
const audioPath = process.env.TRANSCRIPTION_SAMPLE;
const stamp = Date.now();
let cookie = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function mutation(route, input, session = cookie) {
  const response = await fetch(`${base}/api/trpc/${route}?batch=1`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { cookie: session } : {}) },
    body: JSON.stringify({ 0: { json: input } }),
  });
  const body = await response.json();
  if (!response.ok || body?.[0]?.error) throw new Error(`${route}: ${JSON.stringify(body)}`);
  return { value: body[0].result.data.json, response };
}

async function query(route, input, session = cookie) {
  const encoded = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  const response = await fetch(`${base}/api/trpc/${route}?batch=1&input=${encoded}`, {
    headers: session ? { cookie: session } : {},
  });
  const body = await response.json();
  if (!response.ok || body?.[0]?.error) throw new Error(`${route}: ${JSON.stringify(body)}`);
  return body[0].result.data.json;
}

const account = {
  name: "Feature Smoke Test",
  email: `feature-smoke-${stamp}@example.test`,
  password: "Demo-password-2026!",
};
const registered = await mutation("auth.register", account, "");
cookie = registered.response.headers.getSetCookie()[0].split(";")[0];
assert(cookie.startsWith("webdev_app_session="), "registration did not issue the application session");

const profile = (await mutation("auth.updateProfile", { name: "Feature Smoke Verified" })).value;
assert(profile.name === "Feature Smoke Verified", "profile update did not persist");
console.log("PASS authenticated profile update");

const meeting = (await mutation("meetings.create", {
  title: "Intelligence smoke meeting",
  scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  durationMinutes: 30,
})).value;
assert(meeting.id > 0, "meeting creation did not return an id");

const transcript = "Maya confirmed the launch date is October 4. Jordan will complete mobile quality assurance by Friday. The team decided to keep the current onboarding flow.";
const insight = (await mutation("meetingIntelligence.analyze", {
  meetingId: meeting.id,
  title: meeting.title,
  transcript,
  language: "en",
})).value;
assert(insight.persisted && insight.summary && insight.decisions.length && insight.actionItems.length, "meeting intelligence was not generated and persisted");
const saved = await query("meetingIntelligence.get", { meetingId: meeting.id });
assert(saved?.summary === insight.summary && saved.transcript === transcript, "saved meeting intelligence could not be loaded");
console.log("PASS AI summary, key decisions, action items, and database persistence");

const ticket = (await mutation("support.create", {
  name: profile.name,
  email: profile.email,
  category: "meeting",
  message: "Feature smoke test verifies that validated support requests are persisted by the backend.",
})).value;
assert(ticket.id > 0 && ticket.status === "open", "support request was not persisted");
console.log("PASS database-backed support request");

if (audioPath) {
  const bytes = await fs.readFile(audioPath);
  const transcription = (await mutation("meetingIntelligence.transcribe", {
    name: path.basename(audioPath),
    type: "audio/wav",
    data: bytes.toString("base64"),
    meetingTitle: meeting.title,
  })).value;
  assert(transcription.transcript?.trim(), "transcription did not return text");
  console.log("PASS managed speech transcription:", transcription.transcript.trim());
} else {
  console.log("SKIP speech transcription (set TRANSCRIPTION_SAMPLE to a supported audio file)");
}
