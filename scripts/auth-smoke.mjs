const base = process.env.AUTH_SMOKE_URL ?? "http://127.0.0.1:3000";
const stamp = Date.now();
const account = {
  name: "Auth Smoke Test",
  email: `auth-smoke-${stamp}@example.test`,
  password: "Demo-password-2026!",
};
const sessionCookieName = "webdev_app_session";

async function mutation(path, input, cookie) {
  const response = await fetch(`${base}/api/trpc/auth.${path}?batch=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ 0: input === undefined ? {} : { json: input } }),
  });
  const data = await response.json();
  return { response, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasTrpcError(data) {
  return Array.isArray(data) ? Boolean(data[0]?.error) : Boolean(data?.error);
}

const registered = await mutation("register", account);
assert(registered.response.ok, `register failed: ${JSON.stringify(registered.data)}`);
const registeredResult = registered.data?.[0]?.result?.data?.json;
assert(registeredResult?.email === account.email, "registration did not return the new user");
const setCookie = registered.response.headers.getSetCookie?.() ?? [];
const sessionCookie = setCookie.find((value) => value.startsWith(`${sessionCookieName}=`));
assert(sessionCookie, "registration did not issue the session cookie");
const cookie = sessionCookie.split(";")[0];
console.log("PASS register + session cookie issued");

const current = await fetch(`${base}/api/trpc/auth.me?batch=1`, {
  headers: { cookie },
});
const currentData = await current.json();
assert(current.ok && currentData?.[0]?.result?.data?.json?.email === account.email, "auth.me did not resolve the registered session");
console.log("PASS auth.me resolves the signed-in user");

const meetingStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const meeting = await fetch(`${base}/api/trpc/meetings.create?batch=1`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ 0: { json: { title: "Managed backend smoke test", scheduledAt: meetingStart, durationMinutes: 30 } } }),
});
const meetingData = await meeting.json();
assert(meeting.ok && meetingData?.[0]?.result?.data?.json?.title === "Managed backend smoke test", "meeting creation did not persist");
console.log("PASS authenticated meeting creation persisted");

const meetingInput = encodeURIComponent(JSON.stringify({ 0: { json: { cacheKey: "smoke" } } }));
const meetingList = await fetch(`${base}/api/trpc/meetings.list?batch=1&input=${meetingInput}`, { headers: { cookie } });
const meetingListData = await meetingList.json();
const listedMeetings = meetingListData?.[0]?.result?.data?.json;
assert(meetingList.ok && Array.isArray(listedMeetings) && listedMeetings.some((item) => item.title === "Managed backend smoke test"), "meeting list did not return the persisted meeting");
console.log("PASS authenticated meeting list returned persisted data");

const duplicate = await mutation("register", account);
assert(hasTrpcError(duplicate.data), "duplicate email registration should fail");
console.log("PASS duplicate registration rejected");

const wrongPassword = await mutation("login", { email: account.email, password: "Wrong-password" });
assert(hasTrpcError(wrongPassword.data), "incorrect password should fail");
console.log("PASS incorrect password rejected");

const login = await mutation("login", { email: account.email, password: account.password });
assert(login.response.ok, `login failed: ${JSON.stringify(login.data)}`);
assert((login.response.headers.getSetCookie?.() ?? []).some((value) => value.startsWith(`${sessionCookieName}=`)), "login did not issue a session cookie");
console.log("PASS valid login issues a new session");

const logout = await mutation("logout", undefined, cookie);
assert(logout.response.ok, `logout failed: ${JSON.stringify(logout.data)}`);
assert((logout.response.headers.getSetCookie?.() ?? []).some((value) =>
  value.startsWith(`${sessionCookieName}=`) &&
  (value.includes("Max-Age=0") || value.includes("Max-Age=-1") || value.includes("Expires=Thu, 01 Jan 1970"))
), "logout did not clear the session cookie");
console.log("PASS logout clears the session cookie");
