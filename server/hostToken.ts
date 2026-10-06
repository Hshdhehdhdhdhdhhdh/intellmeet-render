import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { ENV } from "./_core/env";

/**
 * Host tokens prove that a socket belongs to the person who OWNS a saved meeting.
 * Only the owner's logged-in session can obtain one (see meetings.hostToken in routers.ts),
 * so a guest who opens the invite link can never become the host.
 */
const fallbackSecret = randomBytes(32).toString("hex");
const secret = () => ENV.cookieSecret || fallbackSecret;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function sign(roomId: string, exp: number) {
  return createHmac("sha256", secret()).update(`host:${roomId}:${exp}`).digest("hex");
}

export function createHostToken(roomId: string) {
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${exp}.${sign(roomId, exp)}`;
}

export function verifyHostToken(roomId: string, token: unknown) {
  if (typeof token !== "string" || token.length > 200) return false;
  const [expText, sig] = token.split(".");
  const exp = Number(expText);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(sign(roomId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
