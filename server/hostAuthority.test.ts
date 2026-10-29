import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHostToken, verifyHostToken } from "./hostToken";
import { registerSignaling } from "./signaling";

let http: HttpServer;
let url = "";
const sockets: Socket[] = [];

function client(): Socket {
  const s = connect(url, { path: "/api/socket", transports: ["websocket"], forceNew: true, reconnection: false });
  sockets.push(s);
  return s;
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
function nextEvent<T = any>(s: Socket, event: string, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (v: T) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}
async function join(s: Socket, payload: Record<string, unknown>) {
  if (!s.connected) await nextEvent(s, "connect");
  const role = nextEvent<{ role: string }>(s, "room-role");
  s.emit("join", payload);
  return (await role).role;
}

beforeAll(async () => {
  http = createServer();
  registerSignaling(http);
  await new Promise<void>(r => http.listen(0, r));
  url = `http://localhost:${(http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  sockets.forEach(s => s.disconnect());
  await new Promise(r => http.close(r));
});

describe("host tokens", () => {
  it("only accepts tokens signed for the same room", () => {
    const token = createHostToken("meeting--5");
    expect(verifyHostToken("meeting--5", token)).toBe(true);
    expect(verifyHostToken("meeting--6", token)).toBe(false);
    expect(verifyHostToken("meeting--5", "1.abc")).toBe(false);
    expect(verifyHostToken("meeting--5", undefined)).toBe(false);
  });
});

describe("single host per meeting", () => {
  it("a guest who opens a saved meeting link first is NOT the host; the owner is, and the guest is then shown to the owner", async () => {
    const room = "meeting--101";
    const guest = client();
    const waiting = nextEvent(guest, "waiting-for-host");
    const guestRole = await join(guest, { roomId: room, name: "Guest One", participantId: "guest-participant-1" });
    expect(guestRole).toBe("guest");
    await waiting;

    const owner = client();
    const request = nextEvent<{ id: string; name: string }>(owner, "admission-request");
    const ownerRole = await join(owner, { roomId: room, name: "Owner", participantId: "owner-participant-1", hostToken: createHostToken(room) });
    expect(ownerRole).toBe("host");
    expect((await request).name).toBe("Guest One");

    const admitted = nextEvent(guest, "admitted");
    owner.emit("admit", { id: guest.id });
    await admitted;
  });

  it("a second person can never become host without the token, even if the host drops", async () => {
    const room = "meeting--102";
    const owner = client();
    await join(owner, { roomId: room, name: "Owner", participantId: "owner-participant-2", hostToken: createHostToken(room) });
    const guest = client();
    const guestAdmitted = nextEvent(guest, "admitted");
    const guestRole = await join(guest, { roomId: room, name: "Guest Two", participantId: "guest-participant-2" });
    expect(guestRole).toBe("guest");
    owner.emit("admit", { id: guest.id });
    await guestAdmitted;

    let promoted = false;
    guest.on("room-role", (r: { role: string }) => {
      if (r.role === "host") promoted = true;
    });
    owner.disconnect();
    await wait(300);
    expect(promoted).toBe(false);

    // The real owner reconnects (new socket) and gets the host role back.
    const owner2 = client();
    const back = await join(owner2, { roomId: room, name: "Owner", participantId: "owner-participant-2", hostToken: createHostToken(room) });
    expect(back).toBe("host");
  });

  it("a forged host token is rejected", async () => {
    const room = "meeting--103";
    const attacker = client();
    const role = await join(attacker, { roomId: room, name: "Attacker", participantId: "attacker-participant", hostToken: "9999999999999.deadbeef" });
    expect(role).toBe("guest");
  });

  it("owner opening a second tab keeps exactly one host", async () => {
    const room = "meeting--104";
    const tab1 = client();
    await join(tab1, { roomId: room, name: "Owner", participantId: "owner-tab-1", hostToken: createHostToken(room) });
    const demoted = nextEvent<{ role: string }>(tab1, "room-role");
    const tab2 = client();
    const role2 = await join(tab2, { roomId: room, name: "Owner", participantId: "owner-tab-2", hostToken: createHostToken(room) });
    expect(role2).toBe("host");
    expect((await demoted).role).toBe("guest");
  });

  it("owner signed in on two devices: the first device stays host, the second joins as a guest who must be admitted", async () => {
    const room = "meeting--105";
    const pc = client();
    expect(await join(pc, { roomId: room, name: "PC", participantId: "owner-pc-0001", hostToken: createHostToken(room), hostKey: "device-key-pc-aaaaaaaaaaaa" })).toBe("host");
    const phone = client();
    const request = nextEvent<{ name: string }>(pc, "admission-request");
    expect(await join(phone, { roomId: room, name: "Phone", participantId: "owner-phone-01", hostToken: createHostToken(room), hostKey: "device-key-phone-bbbbbbbbb" })).toBe("guest");
    expect((await request).name).toBe("Phone");
    // the host device reconnecting still gets the host role back
    pc.disconnect();
    await wait(200);
    const pc2 = client();
    expect(await join(pc2, { roomId: room, name: "PC", participantId: "owner-pc-0001", hostToken: createHostToken(room), hostKey: "device-key-pc-aaaaaaaaaaaa" })).toBe("host");
  });

  it("unsaved rooms: first browser with a host key is host, later visitors are guests, the host key owner reconnects as host", async () => {
    const room = "meeting-demo-room";
    const hostKey = "host-key-aaaaaaaaaaaaaaaa";
    const a = client();
    expect(await join(a, { roomId: room, name: "Creator", participantId: "creator-pid-1", hostKey })).toBe("host");
    const b = client();
    expect(await join(b, { roomId: room, name: "Visitor", participantId: "visitor-pid-1", hostKey: "visitor-key-bbbbbbbbbbbbbbb" })).toBe("guest");
    a.disconnect();
    await wait(200);
    const a2 = client();
    expect(await join(a2, { roomId: room, name: "Creator", participantId: "creator-pid-1", hostKey })).toBe("host");
  });
});
