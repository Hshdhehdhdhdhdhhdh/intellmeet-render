import { io } from "socket.io-client";

const url = "http://127.0.0.1:3000";
const roomId = `meeting-${Date.now()}`;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const connect = () => new Promise((resolve, reject) => {
  const socket = io(url, { path: "/api/socket", transports: ["websocket"], timeout: 5000 });
  const timer = setTimeout(() => reject(new Error("connect timeout")), 7000);
  socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
  socket.once("connect_error", reject);
});
const once = (socket, event, ms = 7000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${event} timeout`)), ms);
  socket.once(event, value => { clearTimeout(timer); resolve(value); });
});

const host = await connect();
const hostRole = once(host, "room-role");
host.emit("join", { roomId, name: "Host Desktop", participantId: "p-host-check-01" });
const hostRoleValue = await hostRole;
if (hostRoleValue.role !== "host") throw new Error("desktop was not host");

const guest = await connect();
const guestWaiting = once(guest, "waiting-for-host");
const request = once(host, "admission-request");
guest.emit("join", { roomId, name: "Phone Guest", participantId: "p-phone-check-01" });
await guestWaiting;
const requestValue = await request;
const admitted = once(guest, "admitted");
host.emit("admit", { id: requestValue.id });
await admitted;

const guestReconnect = await connect();
const reconnectRole = once(guestReconnect, "room-role");
const reconnectAdmitted = once(guestReconnect, "admitted");
guestReconnect.emit("join", { roomId, name: "Phone Guest", participantId: "p-phone-check-01" });
const reconnectRoleValue = await reconnectRole;
await reconnectAdmitted;
if (reconnectRoleValue.role !== "guest") throw new Error("reconnected phone lost guest role");

const hostReconnect = await connect();
const hostReconnectRole = once(hostReconnect, "room-role");
const hostReconnectPeers = once(hostReconnect, "peers");
hostReconnect.emit("join", { roomId, name: "Host Desktop", participantId: "p-host-check-01" });
const hostReconnectRoleValue = await hostReconnectRole;
const peers = await hostReconnectPeers;
if (hostReconnectRoleValue.role !== "host") throw new Error("reconnected desktop lost host role");
if (!Array.isArray(peers) || peers.length < 1) throw new Error("reconnected desktop lost admitted participants");

host.disconnect();
guest.disconnect();
guestReconnect.disconnect();
hostReconnect.disconnect();
console.log(JSON.stringify({ ok: true, roomId, hostRole: hostRoleValue.role, guestReconnectRole: reconnectRoleValue.role, restoredPeers: peers.length }));
