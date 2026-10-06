/**
 * IntellMeet WebRTC layer.
 *
 * Fixes the classic "I can't see the person who joined" problems:
 *  1. Always negotiates BOTH an audio and a video m-line (fixed transceivers), so a
 *     participant who joins without a camera can still RECEIVE everyone's video,
 *     and can turn the camera on later with replaceTrack() — no renegotiation.
 *  2. "Perfect negotiation": both sides may offer at the same time (glare) without
 *     deadlocking; the polite peer rolls back, the impolite peer wins.
 *  3. Signalling messages are processed strictly in order (a per-peer promise queue),
 *     so ICE candidates never race ahead of the SDP they belong to.
 *  4. Uses TURN relays (fetched from /api/ice) so it works across different networks.
 *  5. Automatic ICE restart when a connection drops.
 */

export type SignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

export type LinkStats = { rtt: number | null; loss: number; relay: boolean; quality: "good" | "fair" | "poor" | "connecting" };

export const FALLBACK_ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const ICE_CACHE_KEY = "intellmeet-ice-v1";
const ICE_CACHE_MS = 10 * 60 * 1000;

function readIceCache(): RTCIceServer[] | null {
  try {
    const raw = sessionStorage.getItem(ICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; servers: RTCIceServer[] };
    if (Date.now() - parsed.at < ICE_CACHE_MS && Array.isArray(parsed.servers) && parsed.servers.length) return parsed.servers;
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  // Reuse the list fetched a moment ago (e.g. when rejoining) so connecting starts instantly.
  const cached = readIceCache();
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    const res = await fetch("/api/ice", { cache: "no-store", signal: controller.signal });
    window.clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.iceServers) && json.iceServers.length) {
        try {
          sessionStorage.setItem(ICE_CACHE_KEY, JSON.stringify({ at: Date.now(), servers: json.iceServers }));
        } catch {
          /* storage unavailable */
        }
        return json.iceServers;
      }
    }
  } catch {
    /* fall back below */
  }
  return FALLBACK_ICE;
}

export type LinkCallbacks = {
  send: (to: string, payload: SignalPayload) => void;
  /** remote tracks arrived / changed (re-render tiles) */
  onTracks: (id: string) => void;
  onState: (id: string, state: RTCPeerConnectionState) => void;
};

export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly stream = new MediaStream();
  private audioTx: RTCRtpTransceiver;
  private videoTx: RTCRtpTransceiver;
  private makingOffer = false;
  private ignoreOffer = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private disconnectTimer: number | undefined;
  private lastLoss = { received: 0, lost: 0 };

  constructor(
    readonly id: string,
    private readonly polite: boolean,
    iceServers: RTCIceServer[],
    private readonly cb: LinkCallbacks,
    local: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null }
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle", iceCandidatePoolSize: 4 });
    this.audioTx = this.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.videoTx = this.pc.addTransceiver("video", { direction: "sendrecv" });
    if (local.audio) void this.audioTx.sender.replaceTrack(local.audio).catch(() => undefined);
    if (local.video) void this.videoTx.sender.replaceTrack(local.video).catch(() => undefined);

    this.pc.ontrack = event => {
      const track = event.track;
      if (!this.stream.getTracks().some(t => t.id === track.id)) {
        // keep one track per kind in the combined stream
        this.stream.getTracks().filter(t => t.kind === track.kind).forEach(t => this.stream.removeTrack(t));
        this.stream.addTrack(track);
      }
      track.onunmute = () => this.cb.onTracks(this.id);
      track.onmute = () => this.cb.onTracks(this.id);
      track.onended = () => this.cb.onTracks(this.id);
      this.cb.onTracks(this.id);
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.cb.send(this.id, { candidate: candidate.toJSON() });
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        const offer = await this.pc.createOffer();
        if (this.pc.signalingState !== "stable" || this.closed) return;
        await this.pc.setLocalDescription(offer);
        if (this.pc.localDescription)
          this.cb.send(this.id, { description: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp } });
      } catch (error) {
        console.warn("[rtc] negotiation failed", error);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      window.clearTimeout(this.disconnectTimer);
      const state = this.pc.iceConnectionState;
      if (state === "failed") this.restartIce();
      if (state === "disconnected") this.disconnectTimer = window.setTimeout(() => this.restartIce(), 3500);
    };
    this.pc.onconnectionstatechange = () => this.cb.onState(this.id, this.pc.connectionState);
  }

  private restartIce() {
    if (this.closed || this.pc.signalingState === "closed") return;
    try {
      this.pc.restartIce();
    } catch {
      /* older browsers: negotiationneeded will not fire; a rejoin recovers */
    }
  }

  /** Feed a signalling message from the remote peer (strictly serialised). */
  handleSignal(payload: SignalPayload) {
    this.queue = this.queue.then(() => this.process(payload)).catch(error => console.warn("[rtc] signal error", error));
  }

  private async process({ description, candidate }: SignalPayload) {
    if (this.closed) return;
    const pc = this.pc;
    if (description) {
      const collision = description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) return;
      if (collision) {
        await Promise.all([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(description)]);
      } else {
        await pc.setRemoteDescription(description);
      }
      if (description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription)
          this.cb.send(this.id, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }
    } else if (candidate) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        if (!this.ignoreOffer) console.warn("[rtc] candidate rejected", error);
      }
    }
  }

  /** Swap the outgoing track without renegotiation (null = send nothing). */
  async setTrack(kind: "audio" | "video", track: MediaStreamTrack | null) {
    const sender = (kind === "audio" ? this.audioTx : this.videoTx).sender;
    try {
      await sender.replaceTrack(track);
    } catch (error) {
      console.warn("[rtc] replaceTrack failed", error);
    }
  }

  /** Cap outgoing video bitrate (kbps). Used to keep large meetings smooth. */
  async setMaxVideoBitrate(kbps: number) {
    try {
      const sender = this.videoTx.sender;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = kbps * 1000;
      await sender.setParameters(params);
    } catch {
      /* not ready before first negotiation; applied on the next adapt() */
    }
  }

  get remoteVideoTrack() {
    return this.stream.getVideoTracks()[0] || null;
  }
  get remoteAudioTrack() {
    return this.stream.getAudioTracks()[0] || null;
  }

  async stats(): Promise<LinkStats> {
    const out: LinkStats = { rtt: null, loss: 0, relay: false, quality: "connecting" };
    if (this.pc.connectionState === "closed") return out;
    try {
      const report = await this.pc.getStats();
      let selectedPair: any;
      const locals = new Map<string, any>();
      let received = 0;
      let lost = 0;
      report.forEach((item: any) => {
        if (item.type === "local-candidate") locals.set(item.id, item);
        if (item.type === "candidate-pair" && (item.selected || (item.nominated && item.state === "succeeded"))) selectedPair = item;
        if (item.type === "inbound-rtp" && item.kind === "video") {
          received += item.packetsReceived || 0;
          lost += item.packetsLost || 0;
        }
      });
      if (selectedPair) {
        out.rtt = typeof selectedPair.currentRoundTripTime === "number" ? Math.round(selectedPair.currentRoundTripTime * 1000) : null;
        out.relay = locals.get(selectedPair.localCandidateId)?.candidateType === "relay";
      }
      const dReceived = received - this.lastLoss.received;
      const dLost = lost - this.lastLoss.lost;
      this.lastLoss = { received, lost };
      out.loss = dReceived + dLost > 0 ? Math.max(0, Math.round((dLost / (dReceived + dLost)) * 100)) : 0;
      if (this.pc.connectionState === "connected") {
        const rtt = out.rtt ?? 0;
        out.quality = out.loss > 8 || rtt > 500 ? "poor" : out.loss > 3 || rtt > 250 ? "fair" : "good";
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.disconnectTimer);
    try {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onnegotiationneeded = null;
      this.pc.close();
    } catch {
      /* already closed */
    }
  }
}

/** One shared AudioContext for speaking detection (browsers cap how many you can open). */
let sharedCtx: AudioContext | null = null;
export function audioContext() {
  if (!sharedCtx || sharedCtx.state === "closed") {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    sharedCtx = new Ctx();
  }
  if (sharedCtx.state === "suspended") void sharedCtx.resume().catch(() => undefined);
  return sharedCtx;
}

export class LevelMeter {
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private data: Uint8Array<ArrayBuffer>;
  constructor(stream: MediaStream) {
    const ctx = audioContext();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.fftSize) as Uint8Array<ArrayBuffer>;
  }
  /** 0..1 loudness */
  level() {
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.data.length) * 3.2);
  }
  dispose() {
    try {
      this.source.disconnect();
      this.analyser.disconnect();
    } catch {
      /* ignore */
    }
  }
}
