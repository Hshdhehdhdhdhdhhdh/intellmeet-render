import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { verifyHostToken } from "./hostToken";

type JoinPayload = { roomId?: unknown; name?: unknown; participantId?: unknown; hostToken?: unknown; hostKey?: unknown };
type SignalPayload = { to?: unknown; data?: unknown };
type ChatPayload = { roomId?: unknown; message?: unknown };
type MediaState = { mic: boolean; cam: boolean; screen: boolean; hand: boolean };
type RoomPeer = { id: string; name: string; state: MediaState };
const DEFAULT_STATE: MediaState = { mic: true, cam: true, screen: false, hand: false };
const roomAutoAdmit = new Map<string, boolean>();

const roomHosts = new Map<string, string>();
/**
 * Host authority for rooms that are not tied to a saved meeting. The browser that creates/opens the
 * room first presents a private key; only that same browser can be host afterwards. Saved meetings
 * use a signed host token (only the meeting owner can get one) instead.
 */
const roomHostKeys = new Map<string, string>();
const roomKeyExpiry = new Map<string, ReturnType<typeof setTimeout>>();

/** Public demo rooms and saved account meeting rooms use separate formats. */
export function roomKind(roomId: unknown): "demo" | "account" | null {
  if (typeof roomId !== "string" || roomId.length > 80) return null;
  if (/^meeting-(?:[1-9]\d*|[a-z][a-z0-9-]{2,79})$/i.test(roomId))
    return "demo";
  if (/^meeting--[1-9]\d*$/.test(roomId)) return "account";
  return null;
}

export function canSignalPeer(roomId: unknown, targetRoomId: unknown) {
  return (
    typeof roomId === "string" && roomId.length > 0 && roomId === targetRoomId
  );
}

function admittedPeers(
  io: Server,
  roomId: string,
  selfId?: string
): RoomPeer[] {
  return Array.from(io.sockets.adapter.rooms.get(roomId) ?? new Set<string>())
    .filter(
      id => id !== selfId && io.sockets.sockets.get(id)?.data?.admitted === true
    )
    .map(id => ({
      id,
      name: (io.sockets.sockets.get(id)?.data?.name as string) || "Participant",
      state: (io.sockets.sockets.get(id)?.data?.state as MediaState) || DEFAULT_STATE,
    }));
}

function emitToAdmitted(
  io: Server,
  roomId: string,
  event: string,
  payload: unknown,
  exceptId?: string
) {
  for (const id of Array.from(
    io.sockets.adapter.rooms.get(roomId) ?? new Set<string>()
  )) {
    if (id === exceptId) continue;
    const target = io.sockets.sockets.get(id);
    if (target?.data?.admitted === true) target.emit(event, payload);
  }
}

function roomMembers(io: Server, roomId: string, excludeId?: string) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) ?? new Set<string>()).filter(
    id => id !== excludeId
  );
}

function cancelKeyExpiry(roomId: string) {
  const timer = roomKeyExpiry.get(roomId);
  if (timer) clearTimeout(timer);
  roomKeyExpiry.delete(roomId);
}

/** Forget a room's host key a couple of minutes after the room is empty (so the host can refresh/reconnect safely). */
function scheduleKeyExpiry(io: Server, roomId: string) {
  cancelKeyExpiry(roomId);
  roomKeyExpiry.set(
    roomId,
    setTimeout(() => {
      roomKeyExpiry.delete(roomId);
      if (roomMembers(io, roomId).length === 0) roomHostKeys.delete(roomId);
    }, 2 * 60 * 1000)
  );
}

/** Let the host in (or ask them about) everyone who was already waiting before the host arrived. */
function flushWaiting(io: Server, roomId: string, host: any) {
  for (const id of roomMembers(io, roomId, host.id)) {
    const waiting = io.sockets.sockets.get(id);
    if (!waiting || waiting.data.admitted === true) continue;
    if (roomAutoAdmit.get(roomId) === true) {
      waiting.data.admitted = true;
      waiting.emit("admitted", {
        hostName: (host.data.name as string) || "Host",
        peers: admittedPeers(io, roomId, waiting.id),
      });
      emitToAdmitted(io, roomId, "peer-joined", {
        id: waiting.id,
        name: (waiting.data.name as string) || "Participant",
        state: (waiting.data.state as MediaState) || DEFAULT_STATE,
      }, waiting.id);
    } else {
      host.emit("admission-request", { id: waiting.id, name: (waiting.data.name as string) || "Participant" });
    }
  }
}

/**
 * Called when the current host's socket leaves or drops.
 * Rooms with host authority (saved meetings / host key) NEVER promote a guest: the real host keeps the
 * role and simply gets it back when they reconnect. Only old key-less rooms keep the legacy hand-over.
 */
function onHostGone(io: Server, roomId: string, goneId: string) {
  if (roomHosts.get(roomId) !== goneId) return;
  roomHosts.delete(roomId);
  const remaining = roomMembers(io, roomId, goneId);
  const hasAuthority = roomKind(roomId) === "account" || roomHostKeys.has(roomId);
  if (!remaining.length) {
    roomAutoAdmit.delete(roomId);
    if (roomHostKeys.has(roomId)) scheduleKeyExpiry(io, roomId);
    return;
  }
  if (!hasAuthority) promoteNextHost(io, roomId, goneId);
}

function promoteNextHost(io: Server, roomId: string, excludeId?: string) {
  const members = roomMembers(io, roomId, excludeId)
    .map(id => io.sockets.sockets.get(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate)
    );
  const nextHost =
    members.find(candidate => candidate.data.admitted === true) || members[0];
  if (!nextHost) {
    roomHosts.delete(roomId);
    roomAutoAdmit.delete(roomId);
    return;
  }
  const wasWaiting = nextHost.data.admitted !== true;
  roomHosts.set(roomId, nextHost.id);
  nextHost.data.admitted = true;
  nextHost.emit("room-role", {
    role: "host",
    hostName: (nextHost.data.name as string) || "Host",
    hostId: nextHost.id,
  });
  nextHost.emit("room-settings", { autoAdmit: roomAutoAdmit.get(roomId) === true });
  if (wasWaiting) {
    nextHost.emit("admitted", {
      hostName: (nextHost.data.name as string) || "Host",
      peers: admittedPeers(io, roomId, nextHost.id),
    });
  }
  emitToAdmitted(
    io,
    roomId,
    "host-changed",
    { hostName: (nextHost.data.name as string) || "Host", hostId: nextHost.id },
    nextHost.id
  );
  flushWaiting(io, roomId, nextHost);
}

function removeSocketFromRoom(io: Server, socket: any, roomId: string) {
  if (socket.data.admitted === true)
    emitToAdmitted(io, roomId, "peer-left", { id: socket.id }, socket.id);
  socket.leave(roomId);
  socket.data.roomId = undefined;
  socket.data.admitted = false;
  onHostGone(io, roomId, socket.id);
}

export function registerSignaling(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    path: "/api/socket",
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1_000_000,
    // Faster dead-connection detection so a dropped person is cleaned up quickly.
    // (connectionStateRecovery is intentionally off: a recovered socket silently kept stale host/peer
    // state, which is how a guest could end up as a second host. Every reconnect now re-joins cleanly.)
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  io.on("connection", socket => {
    socket.on("join", async (payload: JoinPayload | null) => {
      const roomId = payload?.roomId;
      const kind = roomKind(roomId);
      const requestedName =
        typeof payload?.name === "string"
          ? payload.name.trim().replace(/\s+/g, " ").slice(0, 72)
          : "";
      const participantId =
        typeof payload?.participantId === "string" &&
        /^[a-zA-Z0-9_-]{8,96}$/.test(payload.participantId)
          ? payload.participantId
          : socket.id;
      if (!kind || typeof roomId !== "string") {
        socket.emit("join-error", "The meeting link is invalid.");
        return;
      }
      if (requestedName.length < 2) {
        socket.emit("join-error", "Enter your actual name before joining.");
        return;
      }

      const previousRoom = socket.data.roomId as string | undefined;
      if (previousRoom && previousRoom !== roomId)
        removeSocketFromRoom(io, socket, previousRoom);
      socket.data.name = requestedName;
      socket.data.participantId = participantId;
      socket.data.roomId = roomId;
      socket.join(roomId);

      const duplicateId = Array.from(
        io.sockets.adapter.rooms.get(roomId) ?? new Set<string>()
      ).find(
        id =>
          id !== socket.id &&
          io.sockets.sockets.get(id)?.data?.participantId === participantId
      );
      const duplicate = duplicateId
        ? io.sockets.sockets.get(duplicateId)
        : undefined;
      const duplicateWasAdmitted = duplicate?.data?.admitted === true;
      if (duplicate) {
        duplicate.leave(roomId);
        duplicate.data.roomId = undefined;
        duplicate.data.admitted = false;
        duplicate.disconnect(true);
      }

      // ---- Who is allowed to be the host? (decided by the server, never by "who connected first") ----
      const hostKey =
        typeof payload?.hostKey === "string" && /^[a-zA-Z0-9_-]{16,96}$/.test(payload.hostKey)
          ? payload.hostKey
          : "";
      let existingHostId = roomHosts.get(roomId);
      let existingHost = existingHostId ? io.sockets.sockets.get(existingHostId) : undefined;
      if (existingHostId && (!existingHost || existingHost.data.roomId !== roomId)) {
        roomHosts.delete(roomId);
        existingHostId = undefined;
        existingHost = undefined;
      }
      cancelKeyExpiry(roomId);
      let mayHost = false;
      if (kind === "account") {
        // Saved meeting: only the signed-in owner holds a valid host token.
        mayHost = verifyHostToken(roomId, payload?.hostToken);
      } else if (hostKey) {
        const storedKey = roomHostKeys.get(roomId);
        if (!storedKey) {
          roomHostKeys.set(roomId, hostKey);
          mayHost = true;
        } else {
          mayHost = storedKey === hostKey;
        }
      } else {
        // Old clients without a key: legacy behaviour (first one in), only when no key owns the room.
        mayHost = !existingHost && !roomHostKeys.has(roomId);
      }
      const isHost = mayHost;
      if (isHost) {
        if (existingHost && existingHost.id !== socket.id) {
          // The real host opened a second tab/device: the newest one is the single host.
          existingHost.emit("room-role", {
            role: "guest",
            hostName: requestedName,
            hostId: socket.id,
          });
        }
        roomHosts.set(roomId, socket.id);
      }
      socket.data.hostAuthorized = isHost;
      socket.data.admitted = isHost || duplicateWasAdmitted || roomAutoAdmit.get(roomId) === true;
      socket.data.state = socket.data.state || { ...DEFAULT_STATE };
      const host = io.sockets.sockets.get(roomHosts.get(roomId) || "");
      socket.emit("room-role", {
        role: isHost ? "host" : "guest",
        hostName: isHost ? requestedName : (host?.data?.name as string) || "Host",
        hostId: roomHosts.get(roomId) || "",
      });

      if (isHost) {
        socket.emit("room-settings", { autoAdmit: roomAutoAdmit.get(roomId) === true });
        socket.emit("peers", admittedPeers(io, roomId, socket.id));
        emitToAdmitted(
          io,
          roomId,
          "host-ready",
          { hostName: requestedName },
          socket.id
        );
        // People who opened the link before the host arrived are now shown to the host.
        flushWaiting(io, roomId, socket);
      } else if (socket.data.admitted === true) {
        socket.emit("admitted", {
          hostName: (host?.data?.name as string) || "Host",
          peers: admittedPeers(io, roomId, socket.id),
        });
        emitToAdmitted(io, roomId, "peer-joined", {
          id: socket.id,
          name: requestedName,
          state: socket.data.state,
        }, socket.id);
      } else {
        socket.emit("waiting-for-host", {
          hostName: (host?.data?.name as string) || "Host",
        });
        host?.emit("admission-request", { id: socket.id, name: requestedName });
      }
    });

    socket.on("admit", (payload: { id?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      const targetId = typeof payload?.id === "string" ? payload.id : "";
      const target = targetId ? io.sockets.sockets.get(targetId) : undefined;
      if (
        !roomId ||
        roomHosts.get(roomId) !== socket.id ||
        !target ||
        target.data.roomId !== roomId ||
        target.data.admitted === true
      )
        return;
      target.data.admitted = true;
      const peer = {
        id: target.id,
        name: (target.data.name as string) || "Participant",
        state: (target.data.state as MediaState) || DEFAULT_STATE,
      };
      target.emit("admitted", {
        hostName: (socket.data.name as string) || "Host",
        peers: admittedPeers(io, roomId, target.id),
      });
      emitToAdmitted(io, roomId, "peer-joined", peer, target.id);
    });

    socket.on("deny", (payload: { id?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      const targetId = typeof payload?.id === "string" ? payload.id : "";
      const target = targetId ? io.sockets.sockets.get(targetId) : undefined;
      if (
        !roomId ||
        roomHosts.get(roomId) !== socket.id ||
        !target ||
        target.data.roomId !== roomId ||
        target.data.admitted === true
      )
        return;
      target.emit("admission-denied", {
        reason: "The host declined this join request.",
      });
      target.leave(roomId);
      target.data.roomId = undefined;
      target.data.admitted = false;
    });

    socket.on("leave-room", (payload: { roomId?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId || !canSignalPeer(roomId, payload?.roomId)) return;
      removeSocketFromRoom(io, socket, roomId);
    });

    socket.on("end-room", (payload: { roomId?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      if (
        !roomId ||
        roomHosts.get(roomId) !== socket.id ||
        !canSignalPeer(roomId, payload?.roomId)
      )
        return;
      const members = Array.from(
        io.sockets.adapter.rooms.get(roomId) ?? new Set<string>()
      );
      for (const id of members) {
        const member = io.sockets.sockets.get(id);
        if (!member) continue;
        member.emit("meeting-ended", { by: socket.data.name || "The host" });
        member.leave(roomId);
        member.data.roomId = undefined;
        member.data.admitted = false;
      }
      roomHosts.delete(roomId);
      roomAutoAdmit.delete(roomId);
      roomHostKeys.delete(roomId);
      cancelKeyExpiry(roomId);
    });

    socket.on("signal", (payload: SignalPayload | null) => {
      const target =
        typeof payload?.to === "string"
          ? io.sockets.sockets.get(payload.to)
          : undefined;
      if (
        !target ||
        socket.data.admitted !== true ||
        target.data.admitted !== true
      )
        return;
      if (!canSignalPeer(socket.data.roomId, target.data.roomId)) return;
      target.emit("signal", {
        from: socket.id,
        name: socket.data.name || "Participant",
        data: payload?.data,
      });
    });

    socket.on("chat", (payload: ChatPayload | null) => {
      if (
        socket.data.admitted !== true ||
        !payload ||
        !canSignalPeer(socket.data.roomId, payload.roomId) ||
        typeof payload.message !== "string"
      )
        return;
      const message = payload.message.trim().slice(0, 1000);
      if (!message) return;
      emitToAdmitted(io, socket.data.roomId as string, "chat", {
        from: socket.id,
        name: socket.data.name || "Participant",
        message,
        time: Date.now(),
      });
    });

    // ---- Media state, reactions, captions and host controls ----
    socket.on("state", (payload: Partial<MediaState> | null) => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId || socket.data.admitted !== true || !payload) return;
      const next: MediaState = {
        mic: payload.mic !== false,
        cam: payload.cam !== false,
        screen: payload.screen === true,
        hand: payload.hand === true,
      };
      socket.data.state = next;
      emitToAdmitted(io, roomId, "peer-state", { id: socket.id, state: next }, socket.id);
    });

    socket.on("reaction", (payload: { emoji?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      const emoji = typeof payload?.emoji === "string" ? payload.emoji.slice(0, 8) : "";
      if (!roomId || socket.data.admitted !== true || !emoji) return;
      emitToAdmitted(io, roomId, "reaction", { from: socket.id, name: socket.data.name, emoji });
    });

    socket.on("caption", (payload: { text?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      const text = typeof payload?.text === "string" ? payload.text.trim().slice(0, 600) : "";
      if (!roomId || socket.data.admitted !== true || !text) return;
      emitToAdmitted(io, roomId, "caption", { from: socket.id, name: socket.data.name || "Participant", text, time: Date.now() }, socket.id);
    });

    socket.on("set-auto-admit", (payload: { value?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId || roomHosts.get(roomId) !== socket.id) return;
      const value = payload?.value === true;
      roomAutoAdmit.set(roomId, value);
      emitToAdmitted(io, roomId, "room-settings", { autoAdmit: value });
      if (value) {
        // admit everyone currently waiting
        for (const id of Array.from(io.sockets.adapter.rooms.get(roomId) ?? new Set<string>())) {
          const waiting = io.sockets.sockets.get(id);
          if (!waiting || waiting.data.admitted === true) continue;
          waiting.data.admitted = true;
          waiting.emit("admitted", {
            hostName: (socket.data.name as string) || "Host",
            peers: admittedPeers(io, roomId, waiting.id),
          });
          emitToAdmitted(io, roomId, "peer-joined", {
            id: waiting.id,
            name: (waiting.data.name as string) || "Participant",
            state: (waiting.data.state as MediaState) || DEFAULT_STATE,
          }, waiting.id);
        }
      }
    });

    socket.on("mute-all", () => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId || roomHosts.get(roomId) !== socket.id) return;
      emitToAdmitted(io, roomId, "force-mute", { by: socket.data.name || "The host" }, socket.id);
    });

    socket.on("remove-peer", (payload: { id?: unknown } | null) => {
      const roomId = socket.data.roomId as string | undefined;
      const targetId = typeof payload?.id === "string" ? payload.id : "";
      const target = targetId ? io.sockets.sockets.get(targetId) : undefined;
      if (!roomId || roomHosts.get(roomId) !== socket.id || !target || target.id === socket.id || target.data.roomId !== roomId) return;
      target.emit("removed", { by: socket.data.name || "The host" });
      emitToAdmitted(io, roomId, "peer-left", { id: target.id }, target.id);
      target.leave(roomId);
      target.data.roomId = undefined;
      target.data.admitted = false;
    });

    socket.on("disconnecting", () => {
      const roomId = socket.data.roomId as string | undefined;
      if (!roomId) return;
      if (socket.data.admitted === true)
        emitToAdmitted(io, roomId, "peer-left", { id: socket.id }, socket.id);
      onHostGone(io, roomId, socket.id);
    });
  });
  return io;
}
