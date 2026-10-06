import { trpc } from "@/lib/trpc";
import { CheckCircle2, FileAudio, Lightbulb, ListChecks, Sparkles, Upload, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type IntelligenceActionItem = { task: string; owner: string; due: string };

type Props = {
  meetingId?: number;
  title: string;
  seedTranscript?: string;
  /** Growing transcript from live captions during the meeting. */
  liveTranscript?: string;
  incomingFile?: File | null;
  onAddTasks?: (items: IntelligenceActionItem[]) => void;
};

type Tab = "Summary" | "Transcript" | "Decisions" | "Action items";

export default function MeetingIntelligence({ meetingId, title, seedTranscript = "", liveTranscript = "", incomingFile, onAddTasks }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const lastIncomingFile = useRef<File | null>(null);
  const [tab, setTab] = useState<Tab>("Summary");
  const [transcript, setTranscript] = useState(seedTranscript);
  const [language, setLanguage] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [decisions, setDecisions] = useState<string[]>([]);
  const [actionItems, setActionItems] = useState<IntelligenceActionItem[]>([]);
  const [loadedMeetingId, setLoadedMeetingId] = useState<number | undefined>(undefined);

  const saved = trpc.meetingIntelligence.get.useQuery(
    { meetingId: meetingId || 1 },
    { enabled: Boolean(meetingId), retry: false },
  );
  const transcribe = trpc.meetingIntelligence.transcribe.useMutation();
  const analyze = trpc.meetingIntelligence.analyze.useMutation();

  useEffect(() => {
    if (meetingId !== loadedMeetingId) {
      setLoadedMeetingId(meetingId);
      setTranscript(seedTranscript);
      setLanguage(null);
      setSummary("");
      setDecisions([]);
      setActionItems([]);
      setTab("Summary");
    }
  }, [loadedMeetingId, meetingId, seedTranscript]);

  useEffect(() => {
    if (liveTranscript) setTranscript(liveTranscript);
  }, [liveTranscript]);

  useEffect(() => {
    if (!saved.data) return;
    setTranscript(saved.data.transcript);
    setLanguage(saved.data.language || null);
    setSummary(saved.data.summary);
    setDecisions(saved.data.decisions);
    setActionItems(saved.data.actionItems);
  }, [saved.data]);

  const transcribeFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Recordings must be smaller than 15 MB.");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the recording."));
        reader.readAsDataURL(file);
      });
      const result = await transcribe.mutateAsync({
        name: file.name,
        type: file.type || "application/octet-stream",
        data: dataUrl.split(",", 2)[1] || "",
        meetingTitle: title,
      });
      setTranscript(result.transcript);
      setLanguage(result.language);
      setTab("Transcript");
      toast.success(`Transcription complete${result.language ? ` · ${result.language}` : ""}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The recording could not be transcribed.");
    }
  };

  useEffect(() => {
    if (!incomingFile || incomingFile === lastIncomingFile.current) return;
    lastIncomingFile.current = incomingFile;
    void transcribeFile(incomingFile);
  }, [incomingFile]);

  const generateInsight = async () => {
    if (transcript.trim().length < 10) {
      toast.error("Upload a recording or add a transcript first.");
      setTab("Transcript");
      return;
    }
    try {
      const result = await analyze.mutateAsync({
        meetingId,
        title,
        transcript: transcript.trim(),
        language,
      });
      setSummary(result.summary);
      setDecisions(result.decisions);
      setActionItems(result.actionItems);
      setTab("Summary");
      toast.success(result.persisted ? "Meeting intelligence generated and saved." : "Meeting intelligence generated for this demo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Meeting intelligence could not be generated.");
    }
  };

  const busy = transcribe.isPending || analyze.isPending || saved.isLoading;

  return (
    <section className="ai-summary" aria-label="Meeting intelligence">
      <div className="summary-head">
        <span className="summary-icon"><Sparkles size={15} /></span>
        <span><strong>AI meeting intelligence</strong><small>Transcription, summary, decisions, and action items</small></span>
        <b><i /> {busy ? "Working…" : meetingId ? "Saved" : "Demo"}</b>
      </div>
      <div className="intelligence-actions">
        <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={13} /> Upload recording</button>
        <button type="button" className="primary-button" onClick={generateInsight} disabled={busy}><WandSparkles size={13} /> {analyze.isPending ? "Generating…" : "Generate insights"}</button>
        <input ref={fileInput} className="file-input-hidden" type="file" accept=".webm,.mp3,.wav,.ogg,.m4a,audio/*,video/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) void transcribeFile(file); event.target.value = ""; }} />
      </div>
      <div className="summary-tabs">
        {(["Summary", "Transcript", "Decisions", "Action items"] as Tab[]).map((item) => (
          <button type="button" key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      <div className="summary-body intelligence-body">
        {tab === "Summary" && (
          <div className="intelligence-result">
            <Sparkles size={16} />
            <div><h4>AI summary</h4><p>{summary || "Upload a recording or paste a transcript, then generate a factual meeting summary."}</p></div>
          </div>
        )}
        {tab === "Transcript" && (
          <div className="transcript-editor">
            <label htmlFor="meeting-transcript"><FileAudio size={14} /> Meeting transcript {language ? `(${language})` : ""}</label>
            <textarea id="meeting-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Upload a recording for automatic transcription, or paste meeting notes here…" maxLength={100000} />
            <small>{transcript.length.toLocaleString()} characters · WebM, MP3, WAV, OGG, or M4A · 15 MB maximum</small>
          </div>
        )}
        {tab === "Decisions" && (
          <div className="insight-list"><h4><Lightbulb size={14} /> Key decisions</h4>{decisions.length ? decisions.map((decision, index) => <p key={`${decision}-${index}`}><CheckCircle2 size={13} /> {decision}</p>) : <p>No decisions generated yet.</p>}</div>
        )}
        {tab === "Action items" && (
          <div className="insight-list"><h4><ListChecks size={14} /> Action items</h4>{actionItems.length ? actionItems.map((item, index) => <p key={`${item.task}-${index}`}><CheckCircle2 size={13} /><span><strong>{item.task}</strong><small>{item.owner} · {item.due}</small></span></p>) : <p>No action items generated yet.</p>}{actionItems.length > 0 && onAddTasks && <button type="button" className="secondary-button add-actions-button" onClick={() => onAddTasks(actionItems)}>Add all to Tasks</button>}</div>
        )}
      </div>
    </section>
  );
}
