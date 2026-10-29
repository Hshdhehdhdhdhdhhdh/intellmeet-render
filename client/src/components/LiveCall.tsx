import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  Check,
  CircleDot,
  Clock,
  Copy,
  Crown,
  Download,
  Hand,
  LayoutGrid,
  Link2,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  Pin,
  PinOff,
  Presentation,
  Send,
  Settings,
  ShieldCheck,
  SmilePlus,
  SwitchCamera,
  UserPlus,
  UserX,
  Users,
  Video,
  VideoOff,
  VolumeX,
  X,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// Toasts go to the top so they never cover the meeting controls.
const TOAST_POS = { position: "top-center" as const, duration: 3500 };
const notify = Object.assign((m: string) => toast(m, TOAST_POS), {
  success: (m: string) => toast.success(m, TOAST_POS),
  error: (m: string) => toast.error(m, TOAST_POS),
});
import { meetingShareUrl } from "@/lib/shareLink";
import { fetchIceServers, FALLBACK_ICE, LevelMeter, PeerLink, audioContext, type LinkStats, type SignalPayload } from "@/lib/rtc";
import "./meeting-room.css";

/* ------------------------------------------------------------------ types */
type MediaState = { mic: boolean; cam: boolean; screen: boolean; hand: boolean };
type PeerInfo = { id: string; name: string; state: MediaState };
type ChatMessage = { id: string; name: string; message: string; time: number; self?: boolean };
type Phase = "prejoin" | "waiting" | "live" | "left";
type LiveCallProps = {
  roomId: string;
  displayName: string;
  onRecordingReady?: (file: File) => void;
  onTranscript?: (text: string) => void;
  /** Lets the page show the real room chat outside the call UI. */
  onChatBridge?: (bridge: { messages: ChatMessage[]; send: (text: string) => void; live: boolean }) => void;
};

const DEFAULT_STATE: MediaState = { mic: true, cam: true, screen: false, hand: false };
const REACTIONS = ["👍", "👏", "❤️", "😂", "😮", "🎉"];

/* ---------------------------------------------------------------- helpers */
const initials = (name: string) =>
  name.trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase() || "?";
const timeLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtElapsed = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:` : "") + `${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};
const audioConstraints = (deviceId?: string): MediaTrackConstraints => ({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
});
const videoConstraints = (deviceId?: string, facing?: "user" | "environment"): MediaTrackConstraints => ({
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
  ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing || "user" } }),
});
function gridShape(n: number) {
  const cols = n <= 1 ? 1 : n === 2 ? 2 : Math.ceil(Math.sqrt(n));
  const colsM = n <= 2 ? 1 : 2;
  return { cols, rows: Math.ceil(n / cols), colsM, rowsM: Math.ceil(n / colsM) };
}
function bitrateFor(n: number) {
  return n <= 2 ? 1500 : n <= 4 ? 800 : n <= 6 ? 450 : n <= 9 ? 250 : 150;
}

/* ------------------------------------------------------------------- tile */
type TileProps = {
  stream: MediaStream | null;
  name: string;
  self?: boolean;
  showVideo: boolean;
  mic: boolean;
  hand: boolean;
  speaking: boolean;
  pinned: boolean;
  screen: boolean;
  isHost: boolean;
  stats?: LinkStats;
  connectionState?: RTCPeerConnectionState;
  audioTick: number;
  onPin: () => void;
  onAudioBlocked?: () => void;
  mirror?: boolean;
};

const Tile = memo(function Tile(p: TileProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const trackKey = p.stream ? p.stream.getTracks().map(t => t.id).join("|") : "";
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = p.stream;
    v.muted = !!p.self;
    v.playsInline = true;
    if (p.stream) {
      v.play().catch((err: any) => {
        // AbortError just means the source changed mid-start; only a real autoplay block needs a tap.
        if (p.self || err?.name !== "NotAllowedError") return;
        v.muted = true;
        v.play().catch(() => undefined);
        p.onAudioBlocked?.();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.stream, trackKey]);
  useEffect(() => {
    const v = ref.current;
    if (!v || p.self || p.audioTick === 0) return;
    v.muted = false;
    v.play().catch(() => undefined);
  }, [p.audioTick, p.self]);

  const connecting = !p.self && p.connectionState && p.connectionState !== "connected";
  return (
    <article
      className={`imr-tile${p.speaking ? " speaking" : ""}${p.screen ? " screen" : ""}${p.mirror ? " mirror" : ""}`}
      onDoubleClick={p.onPin}
    >
      <video ref={ref} autoPlay playsInline className={p.showVideo ? "on" : ""} />
      {!p.showVideo && (
        <div className="imr-avatar">
          <span>{initials(p.name)}</span>
        </div>
      )}
      {connecting && (
        <div className="imr-connecting">
          {p.connectionState === "failed" ? "Reconnecting…" : "Connecting…"}
        </div>
      )}
      {p.hand && <div className="imr-hand" title="Hand raised"><Hand size={14} /></div>}
      <button className="imr-pin" onClick={p.onPin} aria-label={p.pinned ? "Unpin" : "Pin"} title={p.pinned ? "Unpin" : "Pin to main view"}>
        {p.pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <div className="imr-tile-bar">
        <span className="imr-name">
          {p.isHost && <Crown size={12} />} {p.name}
          {p.self ? " (You)" : ""}
          {p.screen ? " · presenting" : ""}
        </span>
        <span className="imr-tile-icons">
          {p.stats && p.stats.quality !== "connecting" && (
            <span
              className={`imr-signal ${p.stats.quality}`}
              title={`Connection ${p.stats.quality}${p.stats.rtt != null ? ` · ${p.stats.rtt} ms` : ""}${p.stats.loss ? ` · ${p.stats.loss}% loss` : ""}${p.stats.relay ? " · relayed" : ""}`}
            >
              <i /><i /><i />
            </span>
          )}
          {p.mic ? <Mic size={13} /> : <MicOff size={13} className="muted" />}
        </span>
      </div>
    </article>
  );
});

/* Private per-browser key that proves "I created / opened this room first" for rooms that are not saved meetings. */
function hostKeyFor(room: string) {
  const gen = () => {
    const raw = (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `hk-${raw}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 90).padEnd(20, "x");
  };
  try {
    const name = `intellmeet-host-key:${room}`;
    let key = localStorage.getItem(name);
    if (!key || !/^[a-zA-Z0-9_-]{16,96}$/.test(key)) {
      key = gen();
      localStorage.setItem(name, key);
    }
    return key;
  } catch {
    return gen();
  }
}

/* ------------------------------------------------------------- component */
export default function LiveCall({ roomId, displayName, onRecordingReady, onTranscript, onChatBridge }: LiveCallProps) {
  /* host authority: saved meetings use a server-signed owner token, other rooms use a private per-browser key */
  const trpcUtils = trpc.useUtils();
  const hostTokenRef = useRef("");
  const joinReadyRef = useRef(false);
  /* media + connection refs (mutable, safe to read from socket callbacks) */
  const socketRef = useRef<Socket | null>(null);
  const linksRef = useRef<Map<string, PeerLink>>(new Map());
  const iceRef = useRef<RTCIceServer[]>(FALLBACK_ICE);
  const icePromise = useRef<Promise<void>>(Promise.resolve());
  const devicesReady = useRef<Promise<void>>(Promise.resolve());
  const micTrack = useRef<MediaStreamTrack | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const facingRef = useRef<"user" | "environment">("user");
  const selectedMic = useRef<string>("");
  const selectedCam = useRef<string>("");
  const phaseRef = useRef<Phase>("prejoin");
  const nameRef = useRef(displayName);
  const stateRef = useRef<MediaState>({ ...DEFAULT_STATE });
  const peersRef = useRef<Record<string, PeerInfo>>({});
  const mountedRef = useRef(true);
  const metersRef = useRef<Map<string, LevelMeter>>(new Map());
  const selfMeter = useRef<LevelMeter | null>(null);
  const recorder = useRef<{ rec: MediaRecorder; ctx: AudioContext; dest: MediaStreamAudioDestinationNode; sources: Map<string, MediaStreamAudioSourceNode>; chunks: Blob[] } | null>(null);
  const recog = useRef<any>(null);
  const captionsOnRef = useRef(false);
  const transcriptRef = useRef<{ name: string; text: string; time: number }[]>([]);
  const transcriptTimer = useRef<number | undefined>(undefined);
  const wakeLock = useRef<any>(null);
  const participantIdRef = useRef("");
  const resTier = useRef(0);
  const startedAt = useRef(0);
  const chatPanelOpen = useRef(false);

  /* UI state */
  const [phase, setPhaseState] = useState<Phase>("prejoin");
  const [status, setStatus] = useState("Checking your camera and microphone…");
  const [connected, setConnected] = useState(false);
  const [joinName, setJoinName] = useState(displayName);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasMic, setHasMic] = useState(false);
  const [hasCam, setHasCam] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [recording, setRecording] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [layout, setLayout] = useState<"grid" | "speaker">("grid");
  const [pinned, setPinned] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "chat" | "people">(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [, setTick] = useState(0);
  const [audioTick, setAudioTick] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, LinkStats>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const [role, setRole] = useState<"host" | "guest">("guest");
  const [hostName, setHostName] = useState("Host");
  const [hostId, setHostId] = useState<string | null>(null);
  const [waitingForHost, setWaitingForHost] = useState(false);
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [autoAdmit, setAutoAdmit] = useState(false);
  const [captionLines, setCaptionLines] = useState<{ key: string; name: string; text: string; at: number }[]>([]);
  const [floating, setFloating] = useState<{ id: string; emoji: string; name: string; x: number }[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [audioIns, setAudioIns] = useState<MediaDeviceInfo[]>([]);
  const [videoIns, setVideoIns] = useState<MediaDeviceInfo[]>([]);
  const [leftReason, setLeftReason] = useState("You left the meeting.");
  const [removedFlag, setRemovedFlag] = useState(false);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const bump = useCallback(() => {
    if (mountedRef.current) setTick(t => t + 1);
  }, []);

  const participantId = () => {
    if (participantIdRef.current) return participantIdRef.current;
    const gen = () => `p-${(crypto as any).randomUUID?.() ?? Date.now() + "-" + Math.random().toString(36).slice(2)}`;
    try {
      const stored = sessionStorage.getItem("intellmeet-participant-id");
      participantIdRef.current = stored || gen();
      sessionStorage.setItem("intellmeet-participant-id", participantIdRef.current);
    } catch {
      participantIdRef.current = gen();
    }
    return participantIdRef.current;
  };

  /* ------------------------------------------------------------- devices */
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setAudioIns(all.filter(d => d.kind === "audioinput"));
      setVideoIns(all.filter(d => d.kind === "videoinput"));
    } catch {
      /* ignore */
    }
  }, []);

  const rebuildLocal = useCallback(() => {
    const tracks = [micTrack.current, camTrack.current].filter(Boolean) as MediaStreamTrack[];
    setLocalStream(tracks.length ? new MediaStream(tracks) : null);
    setHasMic(Boolean(micTrack.current));
    setHasCam(Boolean(camTrack.current));
    selfMeter.current?.dispose();
    selfMeter.current = null;
    if (micTrack.current) {
      try {
        selfMeter.current = new LevelMeter(new MediaStream([micTrack.current]));
      } catch {
        /* no WebAudio */
      }
    }
  }, []);

  const outgoingVideo = () =>
    stateRef.current.screen && screenStream.current ? screenStream.current.getVideoTracks()[0] || null : camTrack.current;

  const broadcastState = useCallback(() => {
    if (phaseRef.current === "live") socketRef.current?.emit("state", stateRef.current);
  }, []);
  const patchState = useCallback(
    (patch: Partial<MediaState>) => {
      stateRef.current = { ...stateRef.current, ...patch };
      broadcastState();
    },
    [broadcastState]
  );

  const acquire = useCallback(
    async (kind: "audio" | "video", deviceId?: string): Promise<MediaStreamTrack | null> => {
      if (!navigator.mediaDevices?.getUserMedia) return null;
      const attempt = async (id?: string) => {
        const s = await navigator.mediaDevices.getUserMedia(
          kind === "audio" ? { audio: audioConstraints(id) } : { video: videoConstraints(id, facingRef.current) }
        );
        return s.getTracks()[0] || null;
      };
      try {
        return await attempt(deviceId || undefined);
      } catch {
        if (deviceId) {
          try {
            return await attempt(undefined);
          } catch {
            /* fallthrough */
          }
        }
        return null;
      }
    },
    []
  );

  const initDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Camera and microphone are not available in this browser. You can still join with chat.");
      return;
    }
    let audio: MediaStreamTrack | null = null;
    let video: MediaStreamTrack | null = null;
    try {
      const both = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: videoConstraints(undefined, facingRef.current) });
      audio = both.getAudioTracks()[0] || null;
      video = both.getVideoTracks()[0] || null;
    } catch {
      video = await acquire("video");
      audio = await acquire("audio");
    }
    if (!mountedRef.current) {
      audio?.stop();
      video?.stop();
      return;
    }
    micTrack.current = audio;
    camTrack.current = video;
    if (audio) selectedMic.current = audio.getSettings().deviceId || "";
    if (video) selectedCam.current = video.getSettings().deviceId || "";
    stateRef.current = { ...stateRef.current, mic: Boolean(audio), cam: Boolean(video) };
    setMicOn(Boolean(audio));
    setCamOn(Boolean(video));
    rebuildLocal();
    void refreshDevices();
    // If the person pressed Join before the camera finished starting, catch everyone up now.
    if (phaseRef.current === "live" || phaseRef.current === "waiting") {
      linksRef.current.forEach(link => {
        void link.setTrack("audio", audio);
        void link.setTrack("video", stateRef.current.screen ? screenStream.current?.getVideoTracks()[0] || null : video);
      });
      broadcastState();
    }
    setStatus(
      audio && video
        ? "Camera and microphone are ready."
        : video
          ? "Camera ready. No microphone found — you can still join."
          : audio
            ? "Microphone ready. No camera found — others will see your initials."
            : "No camera or microphone available. You can still join with chat."
    );
  }, [acquire, broadcastState, rebuildLocal, refreshDevices]);

  /* ------------------------------------------------------ track controls */
  const sendTrackToLinks = (kind: "audio" | "video", track: MediaStreamTrack | null) => {
    linksRef.current.forEach(link => void link.setTrack(kind, track));
  };

  const toggleMic = async () => {
    if (!micTrack.current) {
      const t = await acquire("audio", selectedMic.current);
      if (!t) {
        notify.error("Microphone is not available. Check browser permissions.");
        return;
      }
      micTrack.current = t;
      sendTrackToLinks("audio", t);
      rebuildLocal();
      setMicOn(true);
      patchState({ mic: true });
      return;
    }
    const next = !micTrack.current.enabled;
    micTrack.current.enabled = next;
    setMicOn(next);
    patchState({ mic: next });
  };

  const toggleCamera = async () => {
    if (camTrack.current) {
      camTrack.current.stop();
      camTrack.current = null;
      if (!stateRef.current.screen) sendTrackToLinks("video", null);
      setCamOn(false);
      patchState({ cam: false });
      rebuildLocal();
      return;
    }
    const t = await acquire("video", selectedCam.current);
    if (!t) {
      notify.error("Camera could not be turned on. Check browser permissions.");
      return;
    }
    camTrack.current = t;
    selectedCam.current = t.getSettings().deviceId || selectedCam.current;
    if (!stateRef.current.screen) sendTrackToLinks("video", t);
    setCamOn(true);
    patchState({ cam: true });
    rebuildLocal();
    resTier.current = -1;
    adaptQuality();
    void refreshDevices();
  };

  const flipCamera = async () => {
    facingRef.current = facingRef.current === "user" ? "environment" : "user";
    const old = camTrack.current;
    selectedCam.current = "";
    const t = await acquire("video");
    if (!t) {
      facingRef.current = facingRef.current === "user" ? "environment" : "user";
      notify.error("Could not switch camera.");
      return;
    }
    old?.stop();
    camTrack.current = t;
    if (!stateRef.current.screen) sendTrackToLinks("video", t);
    setCamOn(true);
    patchState({ cam: true });
    rebuildLocal();
  };

  const changeMicDevice = async (id: string) => {
    selectedMic.current = id;
    const wasEnabled = micTrack.current ? micTrack.current.enabled : true;
    const t = await acquire("audio", id);
    if (!t) return notify.error("Could not use that microphone.");
    micTrack.current?.stop();
    t.enabled = wasEnabled;
    micTrack.current = t;
    sendTrackToLinks("audio", t);
    rebuildLocal();
  };
  const changeCamDevice = async (id: string) => {
    selectedCam.current = id;
    const t = await acquire("video", id);
    if (!t) return notify.error("Could not use that camera.");
    camTrack.current?.stop();
    camTrack.current = t;
    if (!stateRef.current.screen) sendTrackToLinks("video", t);
    setCamOn(true);
    patchState({ cam: true });
    rebuildLocal();
  };

  const stopShare = useCallback(() => {
    if (!stateRef.current.screen) return;
    screenStream.current?.getTracks().forEach(t => t.stop());
    screenStream.current = null;
    sendTrackToLinks("video", camTrack.current);
    setSharing(false);
    patchState({ screen: false });
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump, patchState]);

  const toggleShare = async () => {
    if (sharing) return stopShare();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      notify.error("Screen sharing is not supported on this device or browser.");
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      screenStream.current = display;
      track.onended = () => stopShare();
      try {
        (track as any).contentHint = "detail";
      } catch {
        /* optional */
      }
      sendTrackToLinks("video", track);
      setSharing(true);
      patchState({ screen: true });
      bump();
      notify.success("Your screen is now visible to everyone.");
    } catch {
      notify.error("Screen sharing was cancelled or blocked by the browser.");
    }
  };

  const toggleHand = () => {
    const next = !stateRef.current.hand;
    setHandUp(next);
    patchState({ hand: next });
  };

  /* --------------------------------------------------- adaptive quality */
  const adaptQuality = useCallback(() => {
    const n = linksRef.current.size + 1;
    const kbps = bitrateFor(n);
    linksRef.current.forEach(link => void link.setMaxVideoBitrate(kbps));
    const tier = n <= 4 ? 0 : n <= 9 ? 1 : 2;
    if (tier !== resTier.current && camTrack.current) {
      resTier.current = tier;
      const c = tier === 0 ? { width: 1280, height: 720, frameRate: 24 } : tier === 1 ? { width: 640, height: 360, frameRate: 20 } : { width: 320, height: 180, frameRate: 15 };
      camTrack.current.applyConstraints({ width: { ideal: c.width }, height: { ideal: c.height }, frameRate: { ideal: c.frameRate } }).catch(() => undefined);
    }
  }, []);

  /* ------------------------------------------------------------ peers/links */
  const upsertPeer = useCallback((p: { id: string; name?: string; state?: Partial<MediaState> }) => {
    const prev = peersRef.current[p.id];
    const next: PeerInfo = {
      id: p.id,
      name: p.name || prev?.name || "Participant",
      state: { ...DEFAULT_STATE, ...(prev?.state || {}), ...(p.state || {}) },
    };
    peersRef.current = { ...peersRef.current, [p.id]: next };
    if (mountedRef.current) setPeers(peersRef.current);
    return { prev, next };
  }, []);

  const addRecordingSource = useCallback((id: string, stream: MediaStream) => {
    const r = recorder.current;
    if (!r || r.sources.has(id) || !stream.getAudioTracks().length) return;
    try {
      const src = r.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      src.connect(r.dest);
      r.sources.set(id, src);
    } catch {
      /* ignore */
    }
  }, []);

  const ensureLink = useCallback(
    (id: string) => {
      let link = linksRef.current.get(id);
      if (link) return link;
      const socket = socketRef.current;
      if (!socket) return null;
      link = new PeerLink(
        id,
        (socket.id || "") > id, // exactly one side of every pair is "polite"
        iceRef.current,
        {
          send: (to, payload) => socketRef.current?.emit("signal", { to, data: payload }),
          onTracks: pid => {
            const l = linksRef.current.get(pid);
            if (l) addRecordingSource(pid, l.stream);
            bump();
          },
          onState: () => bump(),
        },
        { audio: micTrack.current, video: outgoingVideo() }
      );
      linksRef.current.set(id, link);
      adaptQuality();
      bump();
      return link;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adaptQuality, addRecordingSource, bump]
  );

  const closeLink = useCallback(
    (id: string) => {
      linksRef.current.get(id)?.close();
      linksRef.current.delete(id);
      metersRef.current.get(id)?.dispose();
      metersRef.current.delete(id);
      recorder.current?.sources.get(id)?.disconnect();
      recorder.current?.sources.delete(id);
      const next = { ...peersRef.current };
      delete next[id];
      peersRef.current = next;
      if (mountedRef.current) setPeers(next);
      setPinned(p => (p === id ? null : p));
      adaptQuality();
      bump();
    },
    [adaptQuality, bump]
  );

  const closeAllLinks = useCallback(() => {
    linksRef.current.forEach(l => l.close());
    linksRef.current.clear();
    metersRef.current.forEach(m => m.dispose());
    metersRef.current.clear();
    peersRef.current = {};
    if (mountedRef.current) {
      setPeers({});
      setStats({});
      setSpeaking({});
    }
  }, []);

  /* ------------------------------------------------------------ transcript */
  const pushTranscript = useCallback(
    (name: string, text: string, time = Date.now()) => {
      transcriptRef.current.push({ name, text, time });
      window.clearTimeout(transcriptTimer.current);
      transcriptTimer.current = window.setTimeout(() => {
        onTranscript?.(transcriptRef.current.map(l => `[${timeLabel(l.time)}] ${l.name}: ${l.text}`).join("\n"));
      }, 700);
    },
    [onTranscript]
  );
  const showCaption = useCallback((key: string, name: string, text: string) => {
    setCaptionLines(lines => [...lines.filter(l => l.key !== key), { key, name, text, at: Date.now() }].slice(-3));
  }, []);

  const startCaptions = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      notify.error("Live captions need Chrome, Edge or Safari.");
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-IN";
    r.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = String(event.results[i][0].transcript || "").trim();
        if (!text) continue;
        showCaption("self", nameRef.current, text);
        if (event.results[i].isFinal) {
          pushTranscript(nameRef.current, text);
          socketRef.current?.emit("caption", { text });
        }
      }
    };
    r.onend = () => {
      if (captionsOnRef.current) {
        try {
          r.start();
        } catch {
          /* already started */
        }
      }
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        captionsOnRef.current = false;
        setCaptionsOn(false);
        notify.error("Microphone access is blocked, so captions can't start.");
      }
    };
    captionsOnRef.current = true;
    recog.current = r;
    try {
      r.start();
    } catch {
      /* ignore */
    }
    setCaptionsOn(true);
    notify.success("Live captions on — your speech is transcribed for everyone.");
  };
  const stopCaptions = () => {
    captionsOnRef.current = false;
    try {
      recog.current?.stop();
    } catch {
      /* ignore */
    }
    recog.current = null;
    setCaptionsOn(false);
  };
  const downloadTranscript = () => {
    const text = transcriptRef.current.map(l => `[${timeLabel(l.time)}] ${l.name}: ${l.text}`).join("\n");
    if (!text) return notify("No transcript yet — turn on Captions while people speak.");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${roomId}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* -------------------------------------------------------------- recording */
  const toggleRecord = async () => {
    if (recorder.current) {
      recorder.current.rec.stop();
      return;
    }
    try {
      const ctx = audioContext();
      const dest = ctx.createMediaStreamDestination();
      const sources = new Map<string, MediaStreamAudioSourceNode>();
      if (micTrack.current) {
        const s = ctx.createMediaStreamSource(new MediaStream([micTrack.current]));
        s.connect(dest);
        sources.set("self", s);
      }
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 24000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        sources.forEach(s => s.disconnect());
        recorder.current = null;
        setRecording(false);
        if (!blob.size) return;
        const file = new File([blob], `${roomId}-recording.webm`, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        onRecordingReady?.(file);
        notify.success("Recording saved and sent to Meeting Intelligence.");
      };
      recorder.current = { rec, ctx, dest, sources, chunks };
      linksRef.current.forEach((l, id) => addRecordingSource(id, l.stream));
      rec.start(2000);
      setRecording(true);
      notify.success("Recording started (everyone's audio is mixed).");
    } catch {
      notify.error("Recording is not supported in this browser.");
    }
  };

  /* ------------------------------------------------------------- socket */
  useEffect(() => {
    mountedRef.current = true;
    nameRef.current = displayName;
    icePromise.current = fetchIceServers().then(servers => {
      iceRef.current = servers;
    });
    devicesReady.current = initDevices();
    const unlockAudio = () => void audioContext();
    window.addEventListener("pointerdown", unlockAudio, { once: true });

    const socket = io({ path: "/api/socket", transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelayMax: 4000, timeout: 10000 });
    socketRef.current = socket;

    const sendJoin = () =>
      socket.emit("join", { roomId, name: nameRef.current, participantId: participantId(), hostToken: hostTokenRef.current, hostKey: hostKeyFor(roomId) });

    socket.on("connect", () => {
      setConnected(true);
      if ((phaseRef.current === "live" || phaseRef.current === "waiting") && joinReadyRef.current && !socket.recovered) {
        closeAllLinks();
        sendJoin();
      }
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setConnected(false);
      if (phaseRef.current === "prejoin") setStatus("Can't reach the meeting server — retrying…");
    });
    socket.on("join-error", (message: string) => {
      joinReadyRef.current = false;
      setPhase("prejoin");
      setWaitingForHost(false);
      setStatus(message);
      notify.error(message);
    });
    socket.on("room-role", ({ role: r, hostName: h, hostId: hid }: { role: "host" | "guest"; hostName: string; hostId?: string }) => {
      setRole(r);
      setHostName(h || "Host");
      setHostId(hid || (r === "host" ? socket.id || null : null));
    });
    socket.on("room-settings", ({ autoAdmit: a }: { autoAdmit: boolean }) => setAutoAdmit(Boolean(a)));
    socket.on("waiting-for-host", ({ hostName: h }: { hostName: string }) => {
      setPhase("waiting");
      setWaitingForHost(true);
      setHostName(h || "Host");
    });
    socket.on("admission-request", (req: { id: string; name: string }) => {
      setPending(items => (items.some(i => i.id === req.id) ? items : [...items, req]));
      setPanel(p => p || "people");
      notify(`${req.name} is waiting to join.`);
    });
    const enterRoom = (list: PeerInfo[], host?: string) => {
      setWaitingForHost(false);
      setPhase("live");
      if (!startedAt.current) startedAt.current = Date.now();
      if (host) setHostName(host);
      list.forEach(p => {
        upsertPeer(p);
        ensureLink(p.id);
      });
      socket.emit("state", stateRef.current);
      setStatus(list.length ? `You're live with ${list.length} other participant${list.length === 1 ? "" : "s"}.` : "You're the first one here — share the invite link.");
    };
    socket.on("admitted", ({ hostName: h, peers: list }: { hostName: string; peers: PeerInfo[] }) => enterRoom(list || [], h));
    socket.on("peers", (list: PeerInfo[]) => enterRoom(list || []));
    socket.on("admission-denied", ({ reason }: { reason?: string }) => {
      joinReadyRef.current = false;
      setPhase("prejoin");
      setWaitingForHost(false);
      setStatus(reason || "The host declined your request.");
      notify.error(reason || "The host declined your request.");
    });
    socket.on("host-changed", ({ hostName: h, hostId: hid }: { hostName: string; hostId?: string }) => {
      setHostName(h || "Host");
      if (hid) setHostId(hid);
      notify(`${h || "A participant"} is now the host.`);
    });
    socket.on("peer-joined", (p: PeerInfo) => {
      upsertPeer(p);
      ensureLink(p.id);
      notify.success(`${p.name} joined.`);
    });
    socket.on("peer-state", ({ id, state }: { id: string; state: MediaState }) => {
      const { prev } = upsertPeer({ id, state });
      if (state.hand && !prev?.state.hand) notify(`${peersRef.current[id]?.name || "Someone"} raised a hand ✋`);
    });
    socket.on("peer-left", ({ id }: { id: string }) => {
      const name = peersRef.current[id]?.name;
      closeLink(id);
      if (name) notify(`${name} left.`);
    });
    socket.on("signal", ({ from, name, data }: { from: string; name?: string; data: SignalPayload }) => {
      if (!peersRef.current[from]) upsertPeer({ id: from, name });
      ensureLink(from)?.handleSignal(data || {});
    });
    socket.on("chat", (m: { from: string; name: string; message: string; time: number }) => {
      setMessages(items => [...items, { id: `${m.time}-${Math.random()}`, name: m.name, message: m.message, time: m.time, self: m.from === socket.id }].slice(-200));
      if (m.from !== socket.id && !chatPanelOpen.current) setUnread(u => u + 1);
    });
    socket.on("reaction", (r: { from: string; name: string; emoji: string }) => {
      const id = `${Date.now()}-${Math.random()}`;
      setFloating(items => [...items.slice(-14), { id, emoji: r.emoji, name: r.name, x: 8 + Math.random() * 80 }]);
      window.setTimeout(() => setFloating(items => items.filter(i => i.id !== id)), 3200);
    });
    socket.on("caption", (c: { from: string; name: string; text: string; time: number }) => {
      showCaption(c.from, c.name, c.text);
      pushTranscript(c.name, c.text, c.time);
    });
    socket.on("force-mute", ({ by }: { by?: string }) => {
      if (micTrack.current?.enabled) {
        micTrack.current.enabled = false;
        setMicOn(false);
        patchState({ mic: false });
        notify(`${by || "The host"} muted everyone.`);
      }
    });
    const leaveWith = (reason: string, removed = false) => {
      joinReadyRef.current = false;
      stopCaptions();
      if (recorder.current) recorder.current.rec.stop();
      closeAllLinks();
      stateRef.current = { ...stateRef.current, screen: false, hand: false };
      screenStream.current?.getTracks().forEach(t => t.stop());
      screenStream.current = null;
      setSharing(false);
      setHandUp(false);
      setPanel(null);
      setPending([]);
      setLeftReason(reason);
      setRemovedFlag(removed);
      setPhase("left");
    };
    socket.on("meeting-ended", ({ by }: { by?: string }) => leaveWith(`${by || "The host"} ended this meeting.`));
    socket.on("removed", ({ by }: { by?: string }) => leaveWith(`${by || "The host"} removed you from this meeting.`, true));
    (socket as any).__leaveWith = leaveWith;

    return () => {
      mountedRef.current = false;
      stopCaptions();
      if (recorder.current) {
        try {
          recorder.current.rec.stop();
        } catch {
          /* ignore */
        }
      }
      closeAllLinks();
      micTrack.current?.stop();
      camTrack.current?.stop();
      screenStream.current?.getTracks().forEach(t => t.stop());
      selfMeter.current?.dispose();
      wakeLock.current?.release?.().catch?.(() => undefined);
      window.clearTimeout(transcriptTimer.current);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /* ------------------------------------------------------------- actions */
  const joinMeeting = async () => {
    const name = joinName.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      setStatus("Enter your name before joining.");
      notify.error("Please enter your name to join.");
      return;
    }
    nameRef.current = name;
    setJoinName(name);
    void audioContext();
    joinReadyRef.current = false;
    setPhase("waiting");
    setWaitingForHost(false);
    // Join right away: the camera/mic prompt and TURN list keep finishing in the background and are applied
    // the moment they are ready (initDevices pushes the tracks + state), so nobody waits on a "Connecting" screen.
    const socket = socketRef.current;
    if (!socket) {
      setPhase("prejoin");
      return;
    }
    // Saved meeting: ask the server (as the signed-in user) for a host token. Only the meeting owner gets one.
    const savedId = /^meeting--([1-9]\d*)$/.exec(roomId)?.[1];
    hostTokenRef.current = "";
    if (savedId) {
      let timeoutId: number | undefined;
      try {
        const res = await Promise.race([
          trpcUtils.meetings.hostToken.fetch({ meetingId: Number(savedId) }),
          new Promise<null>(resolve => {
            timeoutId = window.setTimeout(() => resolve(null), 3000);
          }),
        ]);
        if (res === null) {
          const message = "Could not verify meeting access. Check your connection and try again.";
          setPhase("prejoin");
          setWaitingForHost(false);
          setStatus(message);
          notify.error(message);
          return;
        }
        hostTokenRef.current = res.hostToken || "";
      } catch {
        hostTokenRef.current = "";
        const message = "Could not verify meeting access. Check your connection and try again.";
        setPhase("prejoin");
        setWaitingForHost(false);
        setStatus(message);
        notify.error(message);
        return;
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    }
    joinReadyRef.current = true;
    if (socket.connected) socket.emit("join", { roomId, name, participantId: participantId(), hostToken: hostTokenRef.current, hostKey: hostKeyFor(roomId) });
    else socket.connect();
  };

  const leaveMeeting = (end = false) => {
    const socket = socketRef.current;
    if (end && role === "host") socket?.emit("end-room", { roomId });
    else socket?.emit("leave-room", { roomId });
    ((socket as any)?.__leaveWith as (r: string) => void)?.(end && role === "host" ? "You ended the meeting for everyone." : "You left the meeting.");
  };

  const rejoin = async () => {
    setRemovedFlag(false);
    startedAt.current = 0;
    setElapsed(0);
    setMessages([]);
    transcriptRef.current = [];
    setCaptionLines([]);
    setStatus("Checking your camera and microphone…");
    if (!micTrack.current && !camTrack.current) {
      devicesReady.current = initDevices();
      await devicesReady.current;
    }
    setPhase("prejoin");
    if (socketRef.current && !socketRef.current.connected) socketRef.current.connect();
  };

  const copyLink = async () => {
    const url = meetingShareUrl(roomId);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const t = document.createElement("textarea");
      t.value = url;
      t.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1800);
    notify.success("Meeting link copied — send it to anyone you want to invite.");
  };

  useEffect(() => {
    onChatBridge?.({
      messages,
      live: phase === "live",
      send: (text: string) => {
        const message = text.trim();
        if (message) socketRef.current?.emit("chat", { roomId, message });
      },
    });
  }, [messages, phase, roomId, onChatBridge]);

  const sendChat = () => {
    const message = draft.trim();
    if (!message) return;
    socketRef.current?.emit("chat", { roomId, message });
    setDraft("");
  };
  const sendReaction = (emoji: string) => {
    socketRef.current?.emit("reaction", { emoji });
    setReactOpen(false);
  };
  const admit = (id: string) => {
    socketRef.current?.emit("admit", { id });
    setPending(items => items.filter(i => i.id !== id));
  };
  const deny = (id: string) => {
    socketRef.current?.emit("deny", { id });
    setPending(items => items.filter(i => i.id !== id));
  };
  const admitAll = () => {
    pending.forEach(r => socketRef.current?.emit("admit", { id: r.id }));
    setPending([]);
  };
  const openPanel = (p: "chat" | "people") => {
    setPanel(cur => (cur === p ? null : p));
  };
  useEffect(() => {
    chatPanelOpen.current = panel === "chat";
    if (panel === "chat") setUnread(0);
  }, [panel]);

  /* ------------------------------------------------------- live background jobs */
  // meeting clock
  useEffect(() => {
    if (phase !== "live") return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  // keep the screen awake during a meeting
  useEffect(() => {
    if (phase !== "live") return;
    const wl = (navigator as any).wakeLock;
    wl?.request?.("screen").then((l: any) => (wakeLock.current = l)).catch(() => undefined);
    return () => {
      wakeLock.current?.release?.().catch?.(() => undefined);
    };
  }, [phase]);

  // speaking detection + audio level meter (pre-join and live)
  useEffect(() => {
    if (phase === "left" || phase === "waiting") return;
    const t = window.setInterval(() => {
      const levels: Record<string, number> = {};
      const selfLevel = selfMeter.current && micTrack.current?.enabled ? selfMeter.current.level() : 0;
      setMicLevel(selfLevel);
      if (phaseRef.current !== "live") return;
      levels.self = selfLevel;
      linksRef.current.forEach((link, id) => {
        const track = link.remoteAudioTrack;
        if (!track) return;
        let meter = metersRef.current.get(id);
        if (!meter) {
          try {
            meter = new LevelMeter(new MediaStream([track]));
            metersRef.current.set(id, meter);
          } catch {
            return;
          }
        }
        levels[id] = meter.level();
      });
      const next: Record<string, boolean> = {};
      let top: string | null = null;
      let topLevel = 0.06;
      for (const [id, lv] of Object.entries(levels)) {
        next[id] = lv > 0.06;
        if (lv > topLevel) {
          topLevel = lv;
          top = id;
        }
      }
      setSpeaking(prev => {
        const same = Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every(k => prev[k] === next[k]);
        return same ? prev : next;
      });
      if (top) setActiveSpeaker(top);
    }, 300);
    return () => window.clearInterval(t);
  }, [phase]);

  // connection quality
  useEffect(() => {
    if (phase !== "live") return;
    const t = window.setInterval(async () => {
      const out: Record<string, LinkStats> = {};
      await Promise.all(Array.from(linksRef.current.entries()).map(async ([id, l]) => (out[id] = await l.stats())));
      if (mountedRef.current) setStats(out);
    }, 4000);
    return () => window.clearInterval(t);
  }, [phase]);

  // expire captions
  useEffect(() => {
    if (!captionLines.length) return;
    const t = window.setTimeout(() => setCaptionLines(lines => lines.filter(l => Date.now() - l.at < 5000)), 5200);
    return () => window.clearTimeout(t);
  }, [captionLines]);

  // keyboard shortcuts
  useEffect(() => {
    if (phase !== "live") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "m") void toggleMic();
      else if (k === "v") void toggleCamera();
      else if (k === "h") toggleHand();
      else if (k === "c") openPanel("chat");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // device hot-plug
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const h = () => void refreshDevices();
    md.addEventListener("devicechange", h);
    return () => md.removeEventListener("devicechange", h);
  }, [refreshDevices]);

  /* -------------------------------------------------------------- render */
  const selfSharing = sharing && screenStream.current;
  const peerList = useMemo(() => Object.values(peers).sort((a, b) => a.name.localeCompare(b.name)), [peers]);
  const totalCount = peerList.length + 1;
  const sharer = peerList.find(p => p.state.screen)?.id || (selfSharing ? "self" : null);
  const spotlightId =
    pinned && (pinned === "self" || peers[pinned])
      ? pinned
      : sharer
        ? sharer
        : layout === "speaker"
          ? activeSpeaker && (activeSpeaker === "self" || peers[activeSpeaker])
            ? activeSpeaker
            : peerList[0]?.id || "self"
          : null;

  const renderTile = (id: string) => {
    if (id === "self") {
      const stream = selfSharing ? screenStream.current : localStream;
      const showVideo = Boolean(selfSharing || (camOn && camTrack.current));
      return (
        <Tile
          key="self"
          self
          mirror={!selfSharing}
          stream={stream}
          name={nameRef.current || joinName}
          showVideo={showVideo}
          mic={micOn && hasMic}
          hand={handUp}
          speaking={Boolean(speaking.self) && micOn}
          pinned={pinned === "self"}
          screen={Boolean(selfSharing)}
          isHost={role === "host"}
          audioTick={0}
          onPin={() => setPinned(p => (p === "self" ? null : "self"))}
        />
      );
    }
    const p = peers[id];
    const link = linksRef.current.get(id);
    if (!p) return null;
    const hasVideoTrack = Boolean(link?.remoteVideoTrack);
    return (
      <Tile
        key={id}
        stream={link?.stream || null}
        name={p.name}
        showVideo={(p.state.cam || p.state.screen) && hasVideoTrack}
        mic={p.state.mic}
        hand={p.state.hand}
        speaking={Boolean(speaking[id]) && p.state.mic}
        pinned={pinned === id}
        screen={p.state.screen}
        isHost={hostId === id}
        stats={stats[id]}
        connectionState={link?.pc.connectionState}
        audioTick={audioTick}
        onAudioBlocked={() => setAudioBlocked(true)}
        onPin={() => setPinned(cur => (cur === id ? null : id))}
      />
    );
  };

  const allIds = ["self", ...peerList.map(p => p.id)];
  const shape = gridShape(spotlightId ? 1 : totalCount);
  const gridStyle = { "--cols": shape.cols, "--rows": shape.rows, "--cols-m": shape.colsM, "--rows-m": shape.rowsM } as React.CSSProperties;

  /* ---------------------------- pre-join ---------------------------- */
  if (phase === "prejoin")
    return (
      <section className="imr imr-prejoin" aria-label="Join meeting">
        <div className="imr-pre-wrap">
          <div className="imr-pre-head">
            <span className="imr-brand"><CircleDot size={16} /> IntellMeet</span>
            <button className="imr-chip" onClick={copyLink}>
              {linkCopied ? <Check size={14} /> : <Link2 size={14} />} {linkCopied ? "Copied" : "Copy invite link"}
            </button>
          </div>
          <div className="imr-pre-grid">
            <div className="imr-pre-preview">
              <div className="imr-pre-video">
                <Tile
                  self
                  mirror
                  stream={localStream}
                  name={joinName || "You"}
                  showVideo={Boolean(camOn && camTrack.current)}
                  mic={micOn && hasMic}
                  hand={false}
                  speaking={false}
                  pinned={false}
                  screen={false}
                  isHost={false}
                  audioTick={0}
                  onPin={() => undefined}
                />
              </div>
              <div className="imr-pre-controls">
                <button className={`imr-round${micOn && hasMic ? "" : " off"}`} onClick={toggleMic} aria-label="Toggle microphone">
                  {micOn && hasMic ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button className={`imr-round${camOn && hasCam ? "" : " off"}`} onClick={toggleCamera} aria-label="Toggle camera">
                  {camOn && hasCam ? <Video size={20} /> : <VideoOff size={20} />}
                </button>
                {videoIns.length > 1 && (
                  <button className="imr-round" onClick={flipCamera} aria-label="Switch camera">
                    <SwitchCamera size={20} />
                  </button>
                )}
                <div className="imr-meter" aria-label="Microphone level">
                  <i style={{ width: `${Math.round(micLevel * 100)}%` }} />
                </div>
              </div>
            </div>
            <div className="imr-pre-form">
              <span className="imr-eyebrow">Ready to join?</span>
              <h1>{roomId}</h1>
              <label className="imr-field">
                Your name
                <input
                  value={joinName}
                  onChange={e => setJoinName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && void joinMeeting()}
                  maxLength={72}
                  placeholder="Enter your name"
                  autoComplete="name"
                />
              </label>
              {audioIns.length > 0 && (
                <label className="imr-field">
                  Microphone
                  <select value={selectedMic.current} onChange={e => void changeMicDevice(e.target.value)}>
                    {audioIns.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
                  </select>
                </label>
              )}
              {videoIns.length > 0 && (
                <label className="imr-field">
                  Camera
                  <select value={selectedCam.current} onChange={e => void changeCamDevice(e.target.value)}>
                    {videoIns.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                  </select>
                </label>
              )}
              <div className={`imr-status${hasMic || hasCam ? " ok" : ""}`}>
                <span className={`imr-dot${connected ? " live" : ""}`} /> {status}
              </div>
              <button className="imr-join" onClick={() => void joinMeeting()}>
                <Video size={18} /> Join meeting
              </button>
              <small className="imr-note">Your name is shown to everyone in the meeting. Works on phone, tablet and desktop — no app needed.</small>
            </div>
          </div>
        </div>
      </section>
    );

  /* ---------------------------- waiting ---------------------------- */
  if (phase === "waiting")
    return (
      <section className="imr imr-center" aria-label="Waiting room">
        <div className="imr-card">
          <div className="imr-card-icon"><UserPlus size={24} /></div>
          <span className="imr-eyebrow">{waitingForHost ? "You're on the list" : "Joining…"}</span>
          <h2>{waitingForHost ? `Waiting for ${hostName} to let you in` : "Connecting to the meeting"}</h2>
          <p>{waitingForHost ? "Keep this window open — you'll join automatically as soon as you're admitted." : "Setting up secure audio and video."}</p>
          <div className="imr-status"><span className="imr-dot live" /> {waitingForHost ? "Waiting for admission" : "Connecting"}</div>
          <button className="imr-ghost" onClick={() => leaveMeeting(false)}><PhoneOff size={15} /> Cancel</button>
        </div>
      </section>
    );

  /* ----------------------------- left ------------------------------ */
  if (phase === "left")
    return (
      <section className="imr-left" aria-label="Meeting ended">
        <div className="imr-card inline">
          <div className="imr-card-icon"><PhoneOff size={22} /></div>
          <h2>{leftReason}</h2>
          <p>{removedFlag ? "You can ask the host to let you back in." : "You can rejoin any time, or review the AI meeting insights below."}</p>
          <button className="imr-join" onClick={() => void rejoin()}><Video size={18} /> Rejoin meeting</button>
          {transcriptRef.current.length > 0 && (
            <button className="imr-ghost" onClick={downloadTranscript}><Download size={15} /> Download transcript</button>
          )}
        </div>
      </section>
    );

  /* ----------------------------- live ------------------------------ */
  const others = allIds.filter(id => id !== spotlightId);
  return (
    <section className="imr imr-live" aria-label="Live meeting room">
      <header className="imr-top">
        <div className="imr-top-left">
          <span className="imr-brand"><CircleDot size={15} /> IntellMeet</span>
          <span className="imr-room"><span className={`imr-dot${connected ? " live" : ""}`} /> {roomId}</span>
          <button className="imr-chip" onClick={copyLink}>
            {linkCopied ? <Check size={14} /> : <Copy size={14} />} <span className="hide-sm">{linkCopied ? "Copied" : "Invite"}</span>
          </button>
        </div>
        <div className="imr-top-right">
          {!connected && <span className="imr-chip warn">Reconnecting…</span>}
          {recording && <span className="imr-chip rec"><CircleDot size={12} /> REC</span>}
          <span className="imr-chip"><Clock size={13} /> {fmtElapsed(elapsed)}</span>
          <span className="imr-chip"><Users size={13} /> {totalCount}</span>
          {role === "host" && <span className="imr-chip host"><Crown size={13} /> Host</span>}
        </div>
      </header>

      {role === "host" && pending.length > 0 && (
        <div className="imr-alert" role="status">
          <UserPlus size={17} />
          <strong>{pending.length} {pending.length === 1 ? "person wants" : "people want"} to join</strong>
          <span className="spacer" />
          <button onClick={() => setPanel("people")}>Review</button>
          <button className="primary" onClick={admitAll}><Check size={14} /> Admit all</button>
        </div>
      )}
      {audioBlocked && (
        <button className="imr-audio-banner" onClick={() => { setAudioBlocked(false); setAudioTick(t => t + 1); void audioContext(); }}>
          <VolumeX size={16} /> Tap to turn on meeting audio
        </button>
      )}

      <div className="imr-body">
        <main className={`imr-stage${spotlightId ? " has-spot" : ""}`}>
          {spotlightId ? (
            <div className="imr-spot">
              <div className="imr-spot-main">{renderTile(spotlightId)}</div>
              {others.length > 0 && <div className="imr-strip">{others.map(renderTile)}</div>}
            </div>
          ) : (
            <div className={`imr-grid${totalCount > 12 ? " many" : ""}`} style={gridStyle} data-count={totalCount}>
              {allIds.map(renderTile)}
            </div>
          )}

          {totalCount === 1 && (
            <div className="imr-empty">
              <strong>You're the only one here</strong>
              <span>Share the invite link so others can join.</span>
              <button className="imr-chip" onClick={copyLink}><Copy size={14} /> Copy invite link</button>
            </div>
          )}

          <div className="imr-captions" aria-live="polite">
            {captionLines.map(l => (
              <div key={l.key}><b>{l.name}:</b> {l.text}</div>
            ))}
          </div>
          <div className="imr-floaters" aria-hidden>
            {floating.map(f => (
              <span key={f.id} style={{ left: `${f.x}%` }} title={f.name}>{f.emoji}</span>
            ))}
          </div>
        </main>

        {panel && (
          <aside className="imr-panel" aria-label="Meeting panel">
            <div className="imr-panel-head">
              <div className="imr-tabs">
                <button className={panel === "chat" ? "on" : ""} onClick={() => setPanel("chat")}><MessageSquare size={14} /> Chat</button>
                <button className={panel === "people" ? "on" : ""} onClick={() => setPanel("people")}>
                  <Users size={14} /> People <span className="imr-count">{totalCount}</span>
                  {role === "host" && pending.length > 0 && <span className="imr-count alert">{pending.length}</span>}
                </button>
              </div>
              <button className="imr-icon" onClick={() => setPanel(null)} aria-label="Close panel"><X size={16} /></button>
            </div>

            {panel === "chat" ? (
              <>
                <div className="imr-chat">
                  {messages.length === 0 ? (
                    <div className="imr-empty-panel"><MessageSquare size={20} /><strong>No messages yet</strong><span>Messages are visible to everyone in the meeting.</span></div>
                  ) : (
                    messages.map(m => (
                      <div className={`imr-msg${m.self ? " self" : ""}`} key={m.id}>
                        <div><strong>{m.self ? "You" : m.name}</strong><small>{timeLabel(m.time)}</small></div>
                        <p>{m.message}</p>
                      </div>
                    ))
                  )}
                </div>
                <form className="imr-compose" onSubmit={e => { e.preventDefault(); sendChat(); }}>
                  <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Message everyone…" maxLength={1000} aria-label="Message everyone" />
                  <button type="submit" disabled={!draft.trim()} aria-label="Send"><Send size={16} /></button>
                </form>
              </>
            ) : (
              <div className="imr-people">
                {role === "host" && (
                  <div className="imr-host-tools">
                    <label className="imr-switch">
                      <input type="checkbox" checked={autoAdmit} onChange={e => { setAutoAdmit(e.target.checked); socketRef.current?.emit("set-auto-admit", { value: e.target.checked }); }} />
                      <span>Let people in automatically</span>
                    </label>
                    <button className="imr-chip" onClick={() => socketRef.current?.emit("mute-all")}><VolumeX size={13} /> Mute everyone</button>
                  </div>
                )}
                {role === "host" && pending.length > 0 && (
                  <div className="imr-pending">
                    <strong>Waiting to join ({pending.length})</strong>
                    {pending.map(r => (
                      <div className="imr-person" key={r.id}>
                        <span className="imr-av">{initials(r.name)}</span>
                        <span className="grow"><strong>{r.name}</strong><small>Wants to join</small></span>
                        <button className="imr-ok" onClick={() => admit(r.id)} aria-label={`Admit ${r.name}`}><Check size={15} /></button>
                        <button className="imr-no" onClick={() => deny(r.id)} aria-label={`Deny ${r.name}`}><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="imr-person self">
                  <span className="imr-av me">{initials(nameRef.current)}</span>
                  <span className="grow"><strong>{nameRef.current} (You)</strong><small>{role === "host" ? "Host" : "Participant"}</small></span>
                  {handUp && <Hand size={15} className="hand" />}
                  {micOn && hasMic ? <Mic size={15} /> : <MicOff size={15} className="muted" />}
                </div>
                {peerList.map(p => (
                  <div className="imr-person" key={p.id}>
                    <span className="imr-av">{initials(p.name)}</span>
                    <span className="grow"><strong>{p.name}</strong><small>{hostId === p.id ? "Host" : "Participant"}{p.state.screen ? " · presenting" : ""}</small></span>
                    {p.state.hand && <Hand size={15} className="hand" />}
                    {p.state.mic ? <Mic size={15} /> : <MicOff size={15} className="muted" />}
                    {role === "host" && (
                      <button className="imr-no" title="Remove from meeting" aria-label={`Remove ${p.name}`} onClick={() => confirm(`Remove ${p.name} from the meeting?`) && socketRef.current?.emit("remove-peer", { id: p.id })}>
                        <UserX size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="imr-panel-foot"><ShieldCheck size={13} /> {autoAdmit ? "Anyone with the link can join." : "Only people admitted by the host can enter."}</div>
          </aside>
        )}
      </div>

      <footer className="imr-dock">
        <div className="imr-dock-inner">
          <button className={`imr-ctl${micOn && hasMic ? "" : " off"}`} onClick={() => void toggleMic()} aria-label="Microphone (M)" title="Microphone (M)">
            {micOn && hasMic ? <Mic size={20} /> : <MicOff size={20} />}<span>{micOn && hasMic ? "Mute" : "Unmute"}</span>
          </button>
          <button className={`imr-ctl${camOn && hasCam ? "" : " off"}`} onClick={() => void toggleCamera()} aria-label="Camera (V)" title="Camera (V)">
            {camOn && hasCam ? <Video size={20} /> : <VideoOff size={20} />}<span>{camOn && hasCam ? "Camera" : "Start video"}</span>
          </button>
          {typeof navigator !== "undefined" && (navigator.mediaDevices as any)?.getDisplayMedia && (
            <button className={`imr-ctl${sharing ? " active" : ""}`} onClick={() => void toggleShare()} aria-label="Share screen" title="Share screen">
              <MonitorUp size={20} /><span>{sharing ? "Stop" : "Present"}</span>
            </button>
          )}
          <button className={`imr-ctl${handUp ? " active" : ""}`} onClick={toggleHand} aria-label="Raise hand (H)" title="Raise hand (H)">
            <Hand size={20} /><span>Hand</span>
          </button>
          <div className="imr-pop-wrap">
            <button className="imr-ctl" onClick={() => { setReactOpen(o => !o); setMenuOpen(false); }} aria-label="Reactions" title="Reactions">
              <SmilePlus size={20} /><span>React</span>
            </button>
            {reactOpen && (
              <div className="imr-pop react">
                {REACTIONS.map(e => <button key={e} onClick={() => sendReaction(e)}>{e}</button>)}
              </div>
            )}
          </div>
          <button className={`imr-ctl${captionsOn ? " active" : ""}`} onClick={() => (captionsOn ? stopCaptions() : startCaptions())} aria-label="Live captions" title="Live captions & transcript">
            <Captions size={20} /><span>Captions</span>
          </button>
          <button className={`imr-ctl${panel === "chat" ? " active" : ""}`} onClick={() => openPanel("chat")} aria-label="Chat (C)" title="Chat (C)">
            <MessageSquare size={20} />{unread > 0 && <i className="imr-badge">{unread > 9 ? "9+" : unread}</i>}<span>Chat</span>
          </button>
          <button className={`imr-ctl${panel === "people" ? " active" : ""}`} onClick={() => openPanel("people")} aria-label="People" title="People">
            <Users size={20} />{role === "host" && pending.length > 0 && <i className="imr-badge">{pending.length}</i>}<span>People</span>
          </button>
          <div className="imr-pop-wrap">
            <button className="imr-ctl" onClick={() => { setMenuOpen(o => !o); setReactOpen(false); }} aria-label="More options" title="More">
              <MoreVertical size={20} /><span>More</span>
            </button>
            {menuOpen && (
              <div className="imr-pop menu">
                <button onClick={() => { setLayout(l => (l === "grid" ? "speaker" : "grid")); setPinned(null); setMenuOpen(false); }}>
                  {layout === "grid" ? <Presentation size={16} /> : <LayoutGrid size={16} />} {layout === "grid" ? "Speaker view" : "Grid view"}
                </button>
                {videoIns.length > 1 && <button onClick={() => { void flipCamera(); setMenuOpen(false); }}><SwitchCamera size={16} /> Switch camera</button>}
                <button onClick={() => { void toggleRecord(); setMenuOpen(false); }}><CircleDot size={16} /> {recording ? "Stop recording" : "Record (audio) for AI notes"}</button>
                <button onClick={() => { downloadTranscript(); setMenuOpen(false); }}><Download size={16} /> Download transcript</button>
                <button onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}><Settings size={16} /> Audio & video settings</button>
                <button onClick={() => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()); setMenuOpen(false); }}><Maximize size={16} /> Full screen</button>
              </div>
            )}
          </div>
          <button className="imr-ctl leave" onClick={() => leaveMeeting(false)} aria-label="Leave meeting" title="Leave meeting">
            <PhoneOff size={20} /><span>Leave</span>
          </button>
          {role === "host" && (
            <button className="imr-ctl leave end" onClick={() => confirm("End the meeting for everyone?") && leaveMeeting(true)} aria-label="End meeting for everyone" title="End for everyone">
              <X size={20} /><span>End all</span>
            </button>
          )}
        </div>
      </footer>

      {settingsOpen && (
        <div className="imr-modal" onClick={() => setSettingsOpen(false)}>
          <div className="imr-modal-card" onClick={e => e.stopPropagation()}>
            <div className="imr-panel-head"><strong>Audio & video</strong><button className="imr-icon" onClick={() => setSettingsOpen(false)} aria-label="Close"><X size={16} /></button></div>
            <label className="imr-field">Microphone
              <select value={selectedMic.current} onChange={e => void changeMicDevice(e.target.value)}>
                {audioIns.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
              </select>
            </label>
            <label className="imr-field">Camera
              <select value={selectedCam.current} onChange={e => void changeCamDevice(e.target.value)}>
                {videoIns.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
              </select>
            </label>
            <div className="imr-meter big"><i style={{ width: `${Math.round(micLevel * 100)}%` }} /></div>
            <small className="imr-note">Speak to test your microphone level.</small>
          </div>
        </div>
      )}
    </section>
  );
}
