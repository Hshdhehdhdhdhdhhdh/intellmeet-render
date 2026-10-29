import { exportSummary, type ExportFormat } from "@/lib/exportSummary";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  Filter,
  Headphones,
  LayoutDashboard,
  MessageSquare,
  Mic2,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings2,
  Sparkles,
  Target,
  Users,
  Video,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { meetingShareUrl } from "@/lib/shareLink";
import LiveCall from "@/components/LiveCall";
import MeetingIntelligence, { type IntelligenceActionItem } from "@/components/MeetingIntelligence";

type View = "overview" | "meetings" | "workspace" | "tasks" | "analytics" | "calendar" | "reports";
type MeetingStatus = "Live now" | "Upcoming" | "Completed" | "Cancelled";
type Meeting = {
  id: number;
  persistedId?: number;
  title: string;
  date: string;
  dateISO?: string;
  time: string;
  durationMinutes?: number;
  participants: number;
  status: MeetingStatus;
  tone: "teal" | "violet" | "amber";
};
type Task = { id: number; label: string; source: string; due: string; done: boolean };
type Message = { name: string; text: string; time: string; tone: string };
type MeetingRecord = { id: number; title: string; description?: string | null; scheduledAt: string; endsAt?: string; durationMinutes: number; roomId?: string; status?: string };
type CopilotAttachment = { uploadId: string; name: string; type: string; size: number; url: string };

function dateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDate(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return dateInputValue(date);
}

function parseDateInput(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateLabel(dateValue: string) {
  const today = dateInputValue(new Date());
  if (dateValue === today) return "Today";
  if (dateValue === shiftDate(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(parseDateInput(dateValue));
}

function timeLabel(timeValue: string) {
  const [hour, minute] = timeValue.split(":").map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function nextMeetingSlot() {
  const date = new Date();
  date.setMinutes(Math.ceil((date.getMinutes() + 1) / 15) * 15, 0, 0);
  return { date: dateInputValue(date), time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` };
}

function meetingFromRecord(record: MeetingRecord): Meeting {
  const scheduledAt = new Date(record.scheduledAt);
  const dateISO = dateInputValue(scheduledAt);
  const timeValue = `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`;
  return {
    id: -record.id,
    persistedId: record.id,
    title: record.title,
    date: dateLabel(dateISO),
    dateISO,
    time: timeLabel(timeValue),
    durationMinutes: record.durationMinutes,
    participants: 1,
    status: record.status === "cancelled" ? "Cancelled" : (record.status === "live" ? "Live now" : (record.status === "completed" || scheduledAt.getTime() + record.durationMinutes * 60_000 < Date.now() ? "Completed" : "Upcoming")),
    tone: "teal",
  };
}

function meetingDateISO(meeting: Meeting) {
  if (meeting.dateISO) return meeting.dateISO;
  if (meeting.date === "Today") return dateInputValue(new Date());
  if (meeting.date === "Tomorrow") return shiftDate(dateInputValue(new Date()), 1);
  return "";
}

function weekDates(dateValue: string) {
  const date = parseDateInput(dateValue);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(date);
    current.setDate(date.getDate() + index);
    const value = dateInputValue(current);
    return { value, label: new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(current) };
  });
}

function meetingTop(time: string, index: number) {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 22 + index * 72;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const minutes = hour * 60 + Number(match[2]);
  return Math.max(18, Math.min(340, 18 + ((minutes - 9 * 60) / 60) * 80)) + index * 4;
}

const todayISO = dateInputValue(new Date());
export const initialMeetings: Meeting[] = [
  { id: 1, title: "Product weekly sync", date: "Today", dateISO: todayISO, time: "11:00 AM", durationMinutes: 30, participants: 8, status: "Live now", tone: "teal" },
  { id: 2, title: "Design critique", date: "Today", dateISO: todayISO, time: "3:30 PM", durationMinutes: 30, participants: 5, status: "Upcoming", tone: "violet" },
  { id: 3, title: "Customer research", date: "Tomorrow", dateISO: shiftDate(todayISO, 1), time: "10:00 AM", durationMinutes: 30, participants: 6, status: "Upcoming", tone: "amber" },
  { id: 4, title: "Quarterly planning", date: dateLabel(shiftDate(todayISO, 3)), dateISO: shiftDate(todayISO, 3), time: "2:00 PM", durationMinutes: 30, participants: 12, status: "Upcoming", tone: "teal" },
];

const initialTasks: Task[] = [
  { id: 1, label: "Confirm launch metrics", source: "Product weekly sync", due: "Today", done: true },
  { id: 2, label: "Share research synthesis", source: "Customer research", due: "Tomorrow", done: false },
  { id: 3, label: "Review onboarding flow", source: "Design critique", due: "Sep 24", done: false },
  { id: 4, label: "Prepare customer FAQ", source: "Launch planning", due: "Sep 25", done: false },
];

const initialMessages: Message[] = [];

export function filterMeetings(items: Meeting[], query: string) {
  const normalized = query.trim().toLowerCase();
  return normalized ? items.filter((meeting) => meeting.title.toLowerCase().includes(normalized)) : items;
}

const navItems: { id: View; label: string; icon: typeof LayoutDashboard; count?: number }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "meetings", label: "Meetings", icon: Video },
  { id: "workspace", label: "Workspace", icon: Users },
  { id: "tasks", label: "Tasks", icon: CheckCircle2, count: 12 },
  { id: "analytics", label: "Analytics", icon: Activity },
];

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2);
}

function Avatar({ name, tone = "teal" }: { name: string; tone?: string }) {
  return <span className={`avatar avatar-${tone}`} title={name}>{initials(name)}</span>;
}

export default function Home() {
  const auth = useAuth();
  const displayName = auth.user?.name || "Shubham Singh";
  const utils = trpc.useUtils();
  const meetingRecordsQuery = trpc.meetings.list.useQuery({ cacheKey: auth.user?.openId ?? "anonymous" }, { enabled: Boolean(auth.user), retry: false });
  const createMeetingMutation = trpc.meetings.create.useMutation();
  const cancelMeetingMutation = trpc.meetings.cancel.useMutation();
  const [view, setView] = useState<View>("overview");
  const [meetings, setMeetings] = useState<Meeting[]>(() => {
    try {
      const stored = localStorage.getItem("intellmeet-dark-meetings");
      return stored ? JSON.parse(stored) : initialMeetings;
    } catch {
      return initialMeetings;
    }
  });
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [meetingSchedule, setMeetingSchedule] = useState(nextMeetingSlot);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [calendarDate, setCalendarDate] = useState(() => dateInputValue(new Date()));
  const [newTask, setNewTask] = useState("");
  const [message, setMessage] = useState("");
  const [meetingFilter, setMeetingFilter] = useState<"Upcoming" | "Past meetings">("Upcoming");
  const [period, setPeriod] = useState("This week");
  const [showCopilot, setShowCopilot] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotAttachments, setCopilotAttachments] = useState<CopilotAttachment[]>([]);
  const copilotFileInput = useRef<HTMLInputElement>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTargetMeetingId, setInviteTargetMeetingId] = useState<number | null>(null);
  const [returnToNewMeeting, setReturnToNewMeeting] = useState(false);
  const [queuedInvites, setQueuedInvites] = useState<string[]>([]);
  const [demoInvitees, setDemoInvitees] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("intellmeet-queued-invites") || "[]"); }
    catch { return []; }
  });
  const [copilotMessages, setCopilotMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: "I can search meetings, open any workspace view, create a meeting, add a task, or download the report. What should I run?" },
  ]);
  const copilotAsk = trpc.copilot.ask.useMutation();
  const copilotUpload = trpc.copilot.upload.useMutation();
  const meetingInvite = trpc.meetings.invite.useMutation();

  useEffect(() => {
    localStorage.setItem("intellmeet-queued-invites", JSON.stringify(demoInvitees));
  }, [demoInvitees]);

  useEffect(() => {
    if (auth.user) {
      if (meetingRecordsQuery.isSuccess) {
        setMeetings(meetingRecordsQuery.data.map(meetingFromRecord));
      } else if (meetingRecordsQuery.isError) {
        setMeetings([]);
      }
      return;
    }

    try {
      const stored = localStorage.getItem("intellmeet-dark-meetings");
      setMeetings(stored ? JSON.parse(stored) : initialMeetings);
    } catch {
      setMeetings(initialMeetings);
    }
  }, [auth.user?.openId, meetingRecordsQuery.data, meetingRecordsQuery.isSuccess, meetingRecordsQuery.isError]);

  const filteredMeetings = useMemo(() => filterMeetings(meetings, search), [meetings, search]);
  const openTaskCount = tasks.filter((task) => !task.done).length;

  const navigate = (next: View) => {
    setView(next);
    setProfileOpen(false);
    setShowNotifications(false);
  };

  const persistMeetings = (next: Meeting[]) => {
    setMeetings(next);
    localStorage.setItem("intellmeet-dark-meetings", JSON.stringify(next));
  };

  const createMeeting = () => {
    const title = newTitle.trim();
    if (!title) {
      toast.error("Enter a meeting title first.");
      return;
    }
    if (!meetingSchedule.date || !meetingSchedule.time) {
      toast.error("Choose a meeting date and start time.");
      return;
    }
    const scheduledAt = new Date(`${meetingSchedule.date}T${meetingSchedule.time}:00`);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      toast.error("Choose a future date and time.");
      return;
    }

    const finishCreation = (meeting: Meeting) => {
      setMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
      setShowNewMeeting(false);
      setNewTitle("");
      setView("meetings");
      setActiveMeeting(meeting);
      toast.success(auth.user ? "Meeting saved to your account." : "Demo meeting saved in this browser.");
    };

    if (auth.user) {
      // Private key of THIS device: whoever creates the meeting is its only host.
      const hostKey = `hk-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 90).padEnd(20, "x");
      createMeetingMutation.mutate(
        { title, description: newDescription.trim() || undefined, scheduledAt: scheduledAt.toISOString(), durationMinutes, hostKey },
        {
          onSuccess: (record) => {
            try { localStorage.setItem(`intellmeet-host-key:meeting--${record.id}`, hostKey); } catch { /* host key stays in memory only */ }
            finishCreation(meetingFromRecord(record));
            if (queuedInvites.length) {
              const queued = [...queuedInvites];
              void Promise.all(queued.map((email) => meetingInvite.mutateAsync({ meetingId: record.id, email })))
                .then(() => { setQueuedInvites([]); toast.success(`${queued.length} teammate${queued.length === 1 ? "" : "s"} granted room access. Share the meeting link manually.`); })
                .catch((error) => toast.error(error instanceof Error ? error.message : "One or more meeting invitations could not be saved."));
            }
            void utils.meetings.list.invalidate({ cacheKey: auth.user?.openId ?? "anonymous" });
          },
          onError: (error) => toast.error(error.message || "Could not save this meeting."),
        }
      );
      return;
    }

    const meeting: Meeting = {
      id: Date.now(),
      title,
      date: dateLabel(meetingSchedule.date),
      dateISO: meetingSchedule.date,
      time: timeLabel(meetingSchedule.time),
      durationMinutes,
      participants: 1,
      status: "Upcoming",
      tone: "teal",
    };
    persistMeetings([meeting, ...meetings]);
    finishCreation(meeting);
  };

  const sendMessage = () => {
    if (!message.trim()) return;
    setMessages([...messages, { name: "You", text: message.trim(), time: "Now", tone: "violet" }]);
    setMessage("");
    toast.success("Note added. To message other people, use the Chat button inside the video call.");
  };

  const toggleTask = (id: number) => {
    setTasks((items) => items.map((task) => task.id === id ? { ...task, done: !task.done } : task));
  };

  const addTask = () => {
    if (!newTask.trim()) return;
    setTasks([...tasks, { id: Date.now(), label: newTask.trim(), source: "Manual task", due: "Today", done: false }]);
    setNewTask("");
    toast.success("Action item added.");
  };

  const downloadReport = () => {
    const report = `INTELLMEET WORKSPACE REPORT\n\nMeetings: ${meetings.length}\nOpen action items: ${openTaskCount}\nTeam pulse: 87%\nAI notes created: 128\n\nGenerated from the IntellMeet prototype.`;
    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "intellmeet-workspace-report.txt";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Workspace report downloaded.");
  };

  const runCopilotAction = (action: { type: string; view?: View; query?: string; title?: string }) => {
    if (action.type === "navigate" && action.view) {
      navigate(action.view);
      setShowCopilot(false);
      return;
    }
    if (action.type === "search") {
      setSearch(action.query || action.title || "");
      setShowSearch(true);
      setView("meetings");
      return;
    }
    if (action.type === "open_meeting") {
      const needle = (action.title || action.query || "").toLowerCase();
      const meeting = needle ? meetings.find((item) => item.title.toLowerCase().includes(needle)) : undefined;
      if (meeting) {
        setActiveMeeting(meeting);
        setShowCopilot(false);
      } else {
        const missing = action.title || action.query || "that meeting";
        setCopilotMessages((items) => [...items, { role: "assistant", text: `I couldn't find “${missing}” in the current meeting list.` }]);
        toast.error("No matching meeting was found.");
      }
      return;
    }
    if (action.type === "create_meeting" && action.title) {
      setNewTitle(action.title);
      setMeetingSchedule(nextMeetingSlot());
      setShowNewMeeting(true);
      setShowCopilot(false);
      toast.success("Meeting details prepared. Review and create the room.");
      return;
    }
    if (action.type === "add_task" && action.title) {
      setTasks((items) => [...items, { id: Date.now(), label: action.title!, source: "Copilot", due: "Today", done: false }]);
      navigate("tasks");
      toast.success("Action item added from Copilot.");
      return;
    }
    if (action.type === "download_report") {
      downloadReport();
      return;
    }
    if (action.type === "start_meeting") {
      setMeetingSchedule(nextMeetingSlot());
      setShowNewMeeting(true);
      setShowCopilot(false);
    }
  };

  const handleCopilotFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = Math.max(0, 5 - copilotAttachments.length);
    const selected = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      toast.error("Copilot supports up to 5 attachments per request.");
    }
    for (const file of selected) {
      if (file.size > 15 * 1024 * 1024) {
        toast.error(`${file.name} is larger than the 15 MB upload limit.`);
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read file"));
          reader.readAsDataURL(file);
        });
        const data = dataUrl.split(",", 2)[1] || "";
        const uploaded = await copilotUpload.mutateAsync({
          name: file.name,
          type: file.type || "application/octet-stream",
          data,
        });
        setCopilotAttachments((items) => [...items, uploaded]);
        toast.success(`${file.name} attached to Copilot.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not attach ${file.name}.`);
      }
    }
  };

  const askCopilot = async (override?: string) => {
    const prompt = (override ?? copilotPrompt).trim();
    if ((!prompt && copilotAttachments.length === 0) || copilotAsk.isPending || copilotUpload.isPending) return;
    const requestPrompt = prompt || "Analyze the attached files and explain the important points.";
    const attachments = copilotAttachments.map(({ uploadId, name, type }) => ({ uploadId, name, type }));
    setCopilotPrompt("");
    setCopilotMessages((items) => [...items, { role: "user", text: `${requestPrompt}${attachments.length ? `\nAttached: ${attachments.map((file) => file.name).join(", ")}` : ""}` }]);
    try {
      const result = await copilotAsk.mutateAsync({
        prompt: requestPrompt,
        context: `Current view: ${view}. Meetings: ${meetings.map((meeting) => meeting.title).join(", ")}. Open tasks: ${tasks.filter((task) => !task.done).map((task) => task.label).join(", ") || "none"}.`,
        attachments,
      });
      setCopilotAttachments([]);
      setCopilotMessages((items) => [...items, { role: "assistant", text: result.reply }]);
      if (result.action?.type && result.action.type !== "none") runCopilotAction(result.action);
    } catch {
      setCopilotMessages((items) => [...items, { role: "assistant", text: "I could not complete that request. Try asking me to open meetings, add a task, or start a meeting." }]);
    }
  };

  const addIntelligenceTasks = (items: IntelligenceActionItem[]) => {
    setTasks((current) => [
      ...current,
      ...items.map((item, index) => ({
        id: Date.now() + index,
        label: item.task,
        source: activeMeeting?.title || "Meeting intelligence",
        due: item.due,
        done: false,
      })),
    ]);
    toast.success(`${items.length} action item${items.length === 1 ? "" : "s"} added to Tasks.`);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("overview")} aria-label="Go to overview">
          <span className="brand-mark"><Sparkles size={17} /></span><span>IntellMeet</span>
        </button>
        <button className="workspace-switcher" onClick={() => navigate("workspace")}>
          <span className="workspace-avatar">N</span>
          <span><strong>Northstar team</strong><small>Personal workspace</small></span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-section-label">Workspace</span>
        <nav className="main-nav">
          {navItems.map(({ id, label, icon: Icon, count }) => (
            <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}>
              <Icon size={17} /><span>{label}</span>{count && <b className="nav-count">{id === "tasks" ? openTaskCount : count}</b>}
            </button>
          ))}
        </nav>
        <span className="nav-section-label">Productivity</span>
        <nav className="main-nav">
          <button className={view === "calendar" ? "nav-item active" : "nav-item"} onClick={() => navigate("calendar")}><CalendarDays size={17} /><span>Calendar</span></button>
          <button className={view === "reports" ? "nav-item active" : "nav-item"} onClick={() => navigate("reports")}><FileText size={17} /><span>Reports</span></button>
        </nav>
        <div className="sidebar-bottom">
          <button className="upgrade-card" onClick={() => toast("Pro plan preview opened", { description: "AI notes and unlimited rooms are included in this demo." })}>
            <span className="upgrade-icon"><Zap size={15} /></span>
            <span><strong>Make meetings count</strong><small>Northstar Pro · 14 days left</small></span>
            <ArrowUpRight size={14} />
          </button>
          <div className="profile-wrap">
            <button className="profile-row" onClick={() => setProfileOpen(!profileOpen)}>
              <Avatar name={displayName} tone="teal" /><span><strong>{displayName}</strong><small>{auth.user?.email || "Workspace member"}</small></span><MoreHorizontal size={16} />
            </button>
            {profileOpen && <div className="profile-menu"><button onClick={() => window.location.assign("/profile")}><Users size={15} /> My profile</button><button onClick={() => setShowSettings(true)}><Settings2 size={15} /> Workspace settings</button><button onClick={() => toast.success("Profile is ready for submission.")}><CheckCircle2 size={15} /> Project status</button><button onClick={async () => { try { await auth.logout(); window.location.assign("/login"); } catch { toast.error("Could not sign out. Please try again."); } }}><X size={15} /> Sign out</button></div>}
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Northstar team</span><span>/</span><strong>{viewLabel(view)}</strong></div>
          <div className="top-actions">
            <button className="search-pill" onClick={() => setShowSearch(true)}><Search size={15} /><span>Search anything</span><kbd>⌘ K</kbd></button>
            <button className="copilot-launch" onClick={() => setShowCopilot(true)} aria-label="Open Copilot"><Bot size={17} /></button>
            <button className="icon-button" onClick={() => setShowHelp(true)} aria-label="Help"><CircleHelp size={17} /></button>
            <div className="notification-wrap"><button className="icon-button notification" onClick={() => setShowNotifications(!showNotifications)} aria-label="Notifications"><Bell size={17} /><i /></button>{showNotifications && <div className="notification-popover"><strong>Notifications</strong><p>AI summary generated for Product weekly sync.</p><p>Two action items need attention today.</p></div>}</div>
            <button className="profile-chip" onClick={() => setProfileOpen(!profileOpen)}>{initials(displayName)}</button>
          </div>
        </header>

        {view === "overview" && <Overview userName={auth.user?.name?.split(" ")[0] || "there"} meetings={meetings} tasks={tasks} onJoin={setActiveMeeting} onNavigate={navigate} onNew={() => setShowNewMeeting(true)} />}
        {view === "meetings" && <MeetingsView meetings={filteredMeetings} filter={meetingFilter} setFilter={setMeetingFilter} period={period} setPeriod={setPeriod} search={search} setSearch={setSearch} onNew={() => setShowNewMeeting(true)} onOpen={setActiveMeeting} />}
        {view === "workspace" && <WorkspaceView tasks={tasks} messages={messages} message={message} setMessage={setMessage} onSend={sendMessage} onToggleTask={toggleTask} onInvite={() => { setInviteTargetMeetingId(null); setShowInvite(true); }} />}
        {view === "tasks" && <TasksView tasks={tasks} onToggle={toggleTask} newTask={newTask} setNewTask={setNewTask} onAdd={addTask} />}
        {view === "analytics" && <AnalyticsView period={period} setPeriod={setPeriod} />}
        {view === "calendar" && <CalendarView meetings={meetings} selectedDate={calendarDate} onSelectDate={setCalendarDate} onOpen={setActiveMeeting} onNew={() => { setMeetingSchedule((current) => ({ ...current, date: calendarDate })); setShowNewMeeting(true); }} />}
        {view === "reports" && <ReportsView onDownload={downloadReport} onNavigate={navigate} />}
      </main>

      {activeMeeting && <MeetingDrawer meeting={activeMeeting} displayName={displayName} onAddTasks={addIntelligenceTasks} onCancel={(meetingId) => { cancelMeetingMutation.mutate({ meetingId }, { onSuccess: () => { toast.success("Meeting cancelled."); setActiveMeeting(null); void utils.meetings.list.invalidate({ cacheKey: auth.user?.openId ?? "anonymous" }); }, onError: (error) => toast.error(error.message) }); }} onInvite={() => { setInviteTargetMeetingId(activeMeeting.persistedId || null); setActiveMeeting(null); setShowInvite(true); }} onClose={() => setActiveMeeting(null)} messages={messages} message={message} setMessage={setMessage} onSend={sendMessage} />}
      {showNewMeeting && <Modal title="Start a new meeting" subtitle="Create a secure room for your team." onClose={() => setShowNewMeeting(false)}><div className="form-stack"><label>Meeting title<input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createMeeting()} placeholder="e.g. Launch retrospective" maxLength={200} /></label><label>Description<textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="What should the team accomplish?" maxLength={2000} rows={3} /></label><div className="form-row"><MeetingField label="Date" ariaLabel="Meeting date" type="date" value={meetingSchedule.date} min={dateInputValue(new Date())} icon={<CalendarDays size={16} />} onChange={(value) => setMeetingSchedule((current) => ({ ...current, date: value }))} /><MeetingField label="Start time" ariaLabel="Meeting start time" type="time" value={meetingSchedule.time} min={meetingSchedule.date === dateInputValue(new Date()) ? nextMeetingSlot().time : undefined} icon={<Clock3 size={16} />} onChange={(value) => setMeetingSchedule((current) => ({ ...current, time: value }))} /></div><label className="duration-field">Duration<span className="select-control"><Clock3 size={16} /><select aria-label="Meeting duration" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>1 hour 30 minutes</option><option value={120}>2 hours</option></select><ChevronDown size={14} /></span></label><button type="button" className="invite-box invite-button" onClick={() => { setShowNewMeeting(false); setReturnToNewMeeting(true); setInviteTargetMeetingId(null); setShowInvite(true); }}><Users size={17} /><span><strong>Invite teammates</strong><small>Add and validate participants before creating the room.</small></span><ArrowUpRight size={14} /></button><button className="primary-button full" onClick={createMeeting} disabled={createMeetingMutation.isPending}>{createMeetingMutation.isPending ? "Saving meeting…" : <>Create meeting <ArrowUpRight size={15} /></>}</button></div></Modal>}
      {showSearch && <SearchModal query={search} setQuery={setSearch} meetings={meetings} onClose={() => setShowSearch(false)} onNavigate={(next) => { navigate(next); setShowSearch(false); }} onOpen={(meeting) => { setActiveMeeting(meeting); setShowSearch(false); }} />}
      {showHelp && <Modal title="IntellMeet help" subtitle="Everything in this demo is interactive." onClose={() => setShowHelp(false)}><div className="help-grid"><button onClick={() => { setShowHelp(false); navigate("meetings"); }}><Video size={18} /><span><strong>Meeting help</strong><small>Create, join, and review rooms.</small></span><ArrowUpRight size={14} /></button><button onClick={() => { setShowHelp(false); navigate("tasks"); }}><Target size={18} /><span><strong>Action items</strong><small>Track work after every call.</small></span><ArrowUpRight size={14} /></button><button onClick={() => window.location.assign("/support")}><CircleHelp size={18} /><span><strong>Support center</strong><small>FAQs and a saved support request form.</small></span><ArrowUpRight size={14} /></button></div></Modal>}
      {showSettings && <Modal title="Workspace settings" subtitle="Customize the Northstar team workspace." onClose={() => setShowSettings(false)}><div className="settings-list"><label><span><strong>Meeting reminders</strong><small>Notify five minutes before meetings.</small></span><input type="checkbox" defaultChecked /></label><label><span><strong>AI summaries</strong><small>Generate a summary after every room.</small></span><input type="checkbox" defaultChecked /></label><label><span><strong>Weekly digest</strong><small>Receive a report every Friday.</small></span><input type="checkbox" /></label></div></Modal>}
      {showCopilot && (
        <div className="modal-backdrop" onClick={() => setShowCopilot(false)}>
          <div className="copilot-panel" onClick={(event) => event.stopPropagation()}>
            <div className="copilot-header">
              <span>
                <h2>IntellMeet Copilot</h2>
              <p>Ask questions, analyze files, search the workspace, or run meetings, tasks, analytics, and reports.</p>
              </span>
              <button className="icon-button" onClick={() => setShowCopilot(false)} aria-label="Close Copilot"><X size={18} /></button>
            </div>
            <div className="copilot-thread">
              {copilotMessages.map((item, index) => (
                <div key={`${item.role}-${index}`} className={`copilot-bubble ${item.role}`}>{item.text}</div>
              ))}
              {copilotAsk.isPending && <div className="copilot-bubble assistant" role="status">Copilot is thinking…</div>}
            </div>
            <div className="copilot-actions" aria-label="Download conversation">
              <span style={{ fontSize: 12, alignSelf: "center" }}>Download chat:</span>
              {(["docx", "odt", "pdf", "csv", "txt"] as ExportFormat[]).map((f) => (
                <button type="button" key={f} onClick={() => exportSummary(f, { kind: "chat", title: "IntellMeet Copilot conversation", summary: "", decisions: [], actionItems: [], transcript: copilotMessages.map((m) => `${m.role === "user" ? "You" : "Copilot"}: ${m.text.replace(/\n+/g, " ")}`).join("\n") })}>{f === "docx" ? "Word (DOCX)" : f.toUpperCase()}</button>
              ))}
            </div>
            <div className="copilot-actions">
              <button type="button" onClick={() => askCopilot("Open my meetings")}>Open meetings</button>
              <button type="button" onClick={() => askCopilot("Add a task to prepare launch notes")}>Add a task</button>
              <button type="button" onClick={() => askCopilot("Show team analytics")}>Open analytics</button>
              <button type="button" onClick={() => askCopilot("Start a new meeting called Launch review")}>Start meeting</button>
            </div>
            {copilotAttachments.length > 0 && <div className="copilot-attachments" aria-label="Attached files">{copilotAttachments.map((file, index) => <span className="copilot-attachment" key={`${file.name}-${index}`}><FileText size={13} /><span title={file.name}>{file.name}</span><button type="button" onClick={() => setCopilotAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={12} /></button></span>)}</div>}
            <div className="copilot-composer">
              <input
                autoFocus
                value={copilotPrompt}
                onChange={(event) => setCopilotPrompt(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && askCopilot()}
                placeholder="Ask or run anything..."
              />
              <button type="button" className="copilot-attach" onClick={() => copilotFileInput.current?.click()} disabled={copilotAsk.isPending || copilotUpload.isPending} aria-label="Attach files"><Paperclip size={16} /></button>
              <button type="button" onClick={() => askCopilot()} disabled={copilotAsk.isPending || copilotUpload.isPending} aria-label="Send Copilot request"><WandSparkles size={16} /></button>
            </div>
            <input ref={copilotFileInput} className="file-input-hidden" type="file" multiple onChange={(event) => { void handleCopilotFiles(event.target.files); event.target.value = ""; }} aria-label="Choose files for Copilot" />
          </div>
        </div>
      )}
      {showInvite && (
        <Modal title="Invite teammates" subtitle={auth.user ? "Grant a teammate access to your meeting. Share the join link yourself; no email is sent." : "Demo invitations stay on this device; no email is sent."} onClose={() => { setShowInvite(false); if (returnToNewMeeting) { setShowNewMeeting(true); setReturnToNewMeeting(false); } }}>
          <div className="form-stack">
            <label>Email address
              <input
                autoFocus
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@company.com"
              />
            </label>
          <div className="invite-box">
              <Users size={17} />
              <span>
                <strong>Member role</strong>
                <small>Anyone with the shared meeting link can join from their phone or laptop. No sign-in is required.</small>
              </span>
            </div>
            <button
              className="primary-button full"
              onClick={async () => {
                const email = inviteEmail.trim().toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  toast.error("Enter a valid teammate email.");
                  return;
                }
                if (inviteTargetMeetingId && auth.user) {
                  try {
                    const invite = await meetingInvite.mutateAsync({ meetingId: inviteTargetMeetingId, email });
                    toast.success(`Room access granted to ${email}. Share the link: ${meetingShareUrl(`meeting--${invite.meetingId}`)}`);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not grant meeting access.");
                    return;
                  }
                } else {
                  if (auth.user) {
                    setQueuedInvites((current) => current.includes(email) ? current : [...current, email]);
                  } else {
                    setDemoInvitees((current) => current.includes(email) ? current : [...current, email]);
                  }
                  toast.success(auth.user ? `${email} will get access when this meeting is created.` : `Demo invite for ${email} saved on this device.`);
                }
                setInviteEmail("");
                setShowInvite(false);
                setInviteTargetMeetingId(null);
                if (returnToNewMeeting) { setShowNewMeeting(true); setReturnToNewMeeting(false); }
              }}
              disabled={meetingInvite.isPending}
            >
              Send invite
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function viewLabel(view: View) {
  return ({ overview: "Overview", meetings: "Meetings", workspace: "Workspace", tasks: "Tasks", analytics: "Analytics", calendar: "Calendar", reports: "Reports" } as const)[view];
}

function Overview({ userName, meetings, tasks, onJoin, onNavigate, onNew }: { userName: string; meetings: Meeting[]; tasks: Task[]; onJoin: (meeting: Meeting) => void; onNavigate: (view: View) => void; onNew: () => void }) {
  return <section className="page-section overview-page">
    <div className="hero-panel">
      <div className="hero-copy"><span className="eyebrow"><i className="pulse-dot" /> IntellMeet AI workspace</span><h1>Make every meeting<br /><em>actionable.</em></h1><p>Bring conversations, decisions, and momentum into one focused workspace.</p><div className="hero-actions"><button className="primary-button" onClick={onNew}><Plus size={16} /> Start a meeting</button><button className="ghost-button" onClick={() => onNavigate("workspace")}><ArrowUpRight size={16} /> Explore workspace</button></div></div>
      <div className="intelligence-card"><div className="intelligence-head"><span><i /> Meeting intelligence</span><small>02:18</small></div><div className="waveform">{Array.from({ length: 25 }).map((_, index) => <i key={index} style={{ height: `${20 + ((index * 19) % 48)}%` }} />)}</div><div className="intelligence-foot"><WandSparkles size={14} /><span>3 action items detected</span><b>98%</b></div></div>
    </div>
    <div className="section-kicker">Your rhythm</div><div className="section-heading"><h2>{(() => { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night"; })()}, {userName}</h2></div>
    <div className="metric-grid"><Metric icon={<Clock3 size={17} />} label="Focus hours" value="6h 42m" delta="+12%" tone="teal" /><Metric icon={<Video size={17} />} label="Meetings this week" value="18" delta="4.2h total" tone="violet" /><Metric icon={<CheckCircle2 size={17} />} label="Action items" value="24" delta="8 need attention" tone="amber" /><Metric icon={<Activity size={17} />} label="Team pulse" value="86%" delta="+6%" tone="teal" /></div>
    <div className="section-row"><div><span className="section-kicker">Up next</span><h2>Meetings on your radar</h2></div><button className="text-button" onClick={() => onNavigate("calendar")}>View calendar <ArrowUpRight size={14} /></button></div>
    <div className="meeting-grid overview-meetings">{meetings.slice(0, 3).map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} onOpen={() => onJoin(meeting)} />)}</div>
    <div className="overview-bottom"><div className="panel stream-panel"><div className="panel-heading"><div><span className="section-kicker">Team stream</span><h2>Recent activity</h2></div><button className="icon-button" onClick={() => toast("Activity is up to date.")}><MoreHorizontal size={17} /></button></div><ActivityRow name="Maya Nguyen" text="shared meeting notes" meta="Sprint planning · 8m ago" tone="teal" /><ActivityRow name="Jordan Reed" text="completed a task" meta="Update onboarding flow · 21m ago" tone="violet" /><ActivityRow name="Samira Khan" text="joined a workspace" meta="Design systems · 1h ago" tone="amber" /><button className="text-button wide" onClick={() => onNavigate("workspace")}>Open team workspace <ArrowUpRight size={14} /></button></div><div className="panel focus-panel"><span className="section-kicker">Team pulse</span><h2>Strong momentum</h2><div className="focus-score"><strong>86</strong><span>/100</span></div><p>Most of your team feels focused and supported.</p><PulseBar label="Focused" value={72} tone="teal" /><PulseBar label="Energized" value={64} tone="violet" /><PulseBar label="Need support" value={18} tone="amber" /><button className="text-button wide" onClick={() => onNavigate("analytics")}>See insights <ArrowUpRight size={14} /></button></div></div>
  </section>;
}

function Metric({ icon, label, value, delta, tone }: { icon: React.ReactNode; label: string; value: string; delta: string; tone: string }) {
  return <div className="metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><span className="metric-copy"><small>{label}</small><strong>{value}</strong></span><b className="metric-delta">{delta}</b></div>;
}

function ActivityRow({ name, text, meta, tone }: { name: string; text: string; meta: string; tone: string }) {
  return <div className="activity-row"><Avatar name={name} tone={tone} /><span><strong>{name} {text}</strong><small>{meta}</small></span><ArrowUpRight size={14} /></div>;
}

function PulseBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="pulse-bar"><span><small>{label}</small><b>{value}%</b></span><div><i className={tone} style={{ width: `${value}%` }} /></div></div>;
}

function MeetingCard({ meeting, onOpen }: { meeting: Meeting; onOpen: () => void }) {
  return <article className={`meeting-card ${meeting.tone}`}><div className="meeting-card-top"><span><i className={meeting.status === "Live now" ? "live" : ""} />{meeting.status}</span><button onClick={() => toast(`${meeting.title} options opened`)}><MoreHorizontal size={16} /></button></div><div className="meeting-video-icon"><Video size={19} /></div><h3>{meeting.title}</h3><p><Clock3 size={13} /> {meeting.date} · {meeting.time}</p><div className="meeting-card-foot"><span className="avatar-stack"><Avatar name="Maya Nguyen" tone="teal" /><Avatar name="Jordan Reed" tone="violet" /><Avatar name="Samira Khan" tone="amber" /></span><small>{meeting.participants} participants</small><button onClick={onOpen} disabled={meeting.status === "Cancelled"}>{meeting.status === "Live now" ? "Join now" : "Details"} <ArrowUpRight size={13} /></button>{meeting.persistedId && meeting.status === "Upcoming" && <button className="meeting-cancel-link" onClick={(event) => { event.stopPropagation(); toast("Use the meeting details to cancel this meeting."); }}>Cancel</button>}</div></article>;
}

function MeetingsView({ meetings, filter, setFilter, period, setPeriod, search, setSearch, onNew, onOpen }: { meetings: Meeting[]; filter: "Upcoming" | "Past meetings"; setFilter: (filter: "Upcoming" | "Past meetings") => void; period: string; setPeriod: (period: string) => void; search: string; setSearch: (query: string) => void; onNew: () => void; onOpen: (meeting: Meeting) => void }) {
  const visible = filter === "Upcoming" ? meetings : [{ ...initialMeetings[0], id: 101, title: "Sprint planning", date: "Sep 18", status: "Completed" as const }];
  return <section className="page-section"><div className="page-heading"><div><span className="section-kicker">Real-time collaboration</span><h1>Meetings</h1><p>One calm place for every conversation.</p></div><button className="primary-button" onClick={onNew}><Plus size={16} /> Start a meeting</button></div><div className="toolbar-row"><div className="segmented"><button className={filter === "Upcoming" ? "active" : ""} onClick={() => setFilter("Upcoming")}>Upcoming</button><button className={filter === "Past meetings" ? "active" : ""} onClick={() => setFilter("Past meetings")}>Past meetings</button></div><div className="toolbar-actions"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search meetings" /></label><button className="secondary-button" onClick={() => setPeriod(period === "This week" ? "This month" : "This week")}><CalendarDays size={15} /> {period} <ChevronDown size={13} /></button></div></div><div className="meeting-grid">{visible.map((meeting) => <MeetingCard key={meeting.id} meeting={meeting} onOpen={() => onOpen(meeting)} />)}</div><div className="inline-cta"><Radio size={19} /><span><strong>Need a room right now?</strong><small>Create a secure room, invite your team, and turn the transcript into next steps automatically.</small></span><button className="text-button" onClick={onNew}>Open meeting room <ArrowUpRight size={14} /></button></div></section>;
}

function WorkspaceView({ tasks, messages, message, setMessage, onSend, onToggleTask, onInvite }: { tasks: Task[]; messages: Message[]; message: string; setMessage: (message: string) => void; onSend: () => void; onToggleTask: (id: number) => void; onInvite: () => void }) {
  return <section className="page-section"><div className="page-heading"><div><span className="section-kicker">Northstar team</span><h1>Team workspace</h1><p>Everything your team needs between meetings.</p></div><button className="secondary-button" onClick={onInvite}><Users size={15} /> Invite teammates</button></div><div className="workspace-grid"><div className="panel"><div className="panel-heading"><div><h2>Open action items</h2><p>From 12 recent conversations</p></div><button className="icon-button" onClick={() => toast("Use the Tasks page to add a new item.")}><Plus size={17} /></button></div>{tasks.map((task) => <TaskRow key={task.id} task={task} onToggle={() => onToggleTask(task.id)} />)}</div><div className="panel chat-panel"><div className="panel-heading"><div><h2>Team chat</h2><p>Keep the conversation moving</p></div><span className="online-label"><i /> 4 online</span></div><div className="chat-messages">{messages.map((item, index) => <div className="chat-message" key={`${item.name}-${index}`}><Avatar name={item.name} tone={item.tone} /><span><strong>{item.name}</strong><p>{item.text}</p><small>{item.time}</small></span></div>)}</div><div className="chat-input"><button onClick={() => toast("Attachment picker opened.")}><Paperclip size={16} /></button><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSend()} placeholder="Write a message..." /><button className="send-button" onClick={onSend}><Send size={15} /></button></div></div></div></section>;
}

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  return <button className="task-row" onClick={onToggle}><span className={`task-check ${task.done ? "done" : ""}`}>{task.done && <Check size={13} />}</span><span><strong className={task.done ? "completed" : ""}>{task.label}</strong><small>{task.source} · {task.due}</small></span><MoreHorizontal size={15} /></button>;
}

function TasksView({ tasks, onToggle, newTask, setNewTask, onAdd }: { tasks: Task[]; onToggle: (id: number) => void; newTask: string; setNewTask: (task: string) => void; onAdd: () => void }) {
  const todo = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);
  return <section className="page-section"><div className="page-heading"><div><span className="section-kicker">Action center</span><h1>Tasks</h1><p>Turn meeting decisions into visible progress.</p></div><span className="status-chip">{todo.length} open</span></div><div className="tasks-layout"><div className="panel"><div className="task-composer"><input value={newTask} onChange={(event) => setNewTask(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onAdd()} placeholder="Add a new action item" /><button className="primary-button" onClick={onAdd}><Plus size={15} /> Add task</button></div>{tasks.map((task) => <TaskRow key={task.id} task={task} onToggle={() => onToggle(task.id)} />)}</div><div className="panel task-summary"><Target size={23} /><span className="section-kicker">Completion</span><strong>{Math.round((done.length / Math.max(tasks.length, 1)) * 100)}%</strong><p>Complete the highest-impact items before the next team sync.</p><div className="focus-track"><i style={{ width: `${Math.round((done.length / Math.max(tasks.length, 1)) * 100)}%` }} /></div></div></div><div className="kanban-board" aria-label="Project board"><div className="kanban-column"><strong>To do</strong><small>{todo.length} items</small>{todo.map((task) => <button key={task.id} className="kanban-card" onClick={() => onToggle(task.id)}><b>{task.label}</b><span>{task.source}</span></button>)}</div><div className="kanban-column"><strong>In review</strong><small>From meetings</small><div className="kanban-card muted"><b>Mobile QA pass</b><span>Product weekly sync</span></div></div><div className="kanban-column"><strong>Done</strong><small>{done.length} items</small>{done.map((task) => <button key={task.id} className="kanban-card done" onClick={() => onToggle(task.id)}><b>{task.label}</b><span>{task.source}</span></button>)}</div></div></section>;
}

function AnalyticsView({ period, setPeriod }: { period: string; setPeriod: (period: string) => void }) {
  return <section className="page-section"><div className="page-heading"><div><span className="section-kicker">Insights</span><h1>Team analytics</h1><p>A clearer view of how collaboration is working.</p></div><button className="secondary-button" onClick={() => setPeriod(period === "Last 30 days" ? "Last 90 days" : "Last 30 days")}><CalendarDays size={15} /> {period === "This week" ? "Last 30 days" : period} <ChevronDown size={13} /></button></div><div className="analytics-grid"><div className="analytics-card large"><span>Meeting load</span><strong>18.4 hrs</strong><small>↗ 8.2% from previous period</small><div className="line-chart"><span /><svg viewBox="0 0 600 180" preserveAspectRatio="none"><path d="M0 145 C55 125,75 135,120 100 S190 125,235 90 S300 110,345 62 S420 72,468 80 S535 38,600 50" fill="none" stroke="#65dfdc" strokeWidth="4" strokeLinecap="round" /></svg></div></div><div className="analytics-card"><span>Avg. response time</span><strong>2h 18m</strong><small>↘ 14% faster</small><div className="mini-bars">{[38, 50, 42, 65, 58, 82, 72].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div><div className="analytics-card"><span>AI notes created</span><strong>128</strong><small>↗ 23 this week</small><div className="ai-saving"><WandSparkles size={22} /><span>Saving your team <b>6.5 hrs</b><br />every week</span></div></div></div></section>;
}

function CalendarView({ meetings, selectedDate, onSelectDate, onOpen, onNew }: { meetings: Meeting[]; selectedDate: string; onSelectDate: (date: string) => void; onOpen: (meeting: Meeting) => void; onNew: () => void }) {
  const days = weekDates(selectedDate);
  const selectedMeetings = meetings.filter((meeting) => meetingDateISO(meeting) === selectedDate);
  return <section className="page-section"><div className="page-heading"><div><span className="section-kicker">Schedule</span><h1>Calendar</h1><p>Select a date to view or schedule meetings.</p></div><button className="primary-button" onClick={onNew}><Plus size={16} /> New meeting</button></div><div className="calendar-selection-row"><label className="calendar-date-picker">Choose date<input aria-label="Calendar date" type="date" value={selectedDate} onChange={(event) => onSelectDate(event.target.value)} /></label><div className="calendar-week-nav"><button type="button" onClick={() => onSelectDate(shiftDate(selectedDate, -7))}>Previous week</button><button type="button" onClick={() => onSelectDate(dateInputValue(new Date()))}>Today</button><button type="button" onClick={() => onSelectDate(shiftDate(selectedDate, 7))}>Next week</button></div></div><div className="calendar-panel"><div className="calendar-head">{days.map((day) => <button type="button" key={day.value} className={day.value === selectedDate ? "active" : ""} aria-pressed={day.value === selectedDate} onClick={() => onSelectDate(day.value)}>{day.label}</button>)}</div><div className="calendar-body"><div className="time-column"><span>9 AM</span><span>11 AM</span><span>1 PM</span><span>3 PM</span><span>5 PM</span></div><div className="calendar-events">{selectedMeetings.length === 0 && <p className="calendar-empty">No meetings scheduled for {dateLabel(selectedDate)}. Select “New meeting” to add one.</p>}{selectedMeetings.map((meeting, index) => <button key={meeting.id} className={`calendar-event ${meeting.tone}`} style={{ top: `${meetingTop(meeting.time, index)}px`, left: "4%", width: "92%" }} onClick={() => onOpen(meeting)}><strong>{meeting.title}</strong><small>{meeting.time} · {meeting.durationMinutes || 30} min · {meeting.participants} people</small></button>)}</div></div></div></section>;
}

function ReportsView({ onDownload, onNavigate }: { onDownload: () => void; onNavigate: (view: View) => void }) {
  return <section className="page-section"><div className="page-heading"><div><span className="section-kicker">Executive summary</span><h1>Reports</h1><p>Share the value your meeting system creates.</p></div><button className="primary-button" onClick={onDownload}><Download size={15} /> Download report</button></div><div className="report-hero"><BarChart3 size={28} /><div><span className="section-kicker">September workspace report</span><h2>Meetings are becoming more actionable.</h2><p>Your team completed 77% of assigned actions and saved an estimated 6.5 hours with AI-generated notes.</p></div></div><div className="report-grid"><button onClick={() => onNavigate("analytics")}><span>Collaboration health</span><strong>87%</strong><small>View analytics <ArrowUpRight size={12} /></small></button><button onClick={() => onNavigate("tasks")}><span>Action completion</span><strong>77%</strong><small>Review tasks <ArrowUpRight size={12} /></small></button><button onClick={() => onNavigate("meetings")}><span>Meeting quality</span><strong>92%</strong><small>Inspect meetings <ArrowUpRight size={12} /></small></button></div></section>;
}

function MeetingDrawer({ meeting, displayName, onAddTasks, onCancel, onInvite, onClose, messages, message, setMessage, onSend }: { meeting: Meeting; displayName: string; onAddTasks: (items: IntelligenceActionItem[]) => void; onCancel: (meetingId: number) => void; onInvite: () => void; onClose: () => void; messages: Message[]; message: string; setMessage: (message: string) => void; onSend: () => void }) {
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [audio, setAudio] = useState(true);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [meetingContext, setMeetingContext] = useState("");
  const [chatBridge, setChatBridge] = useState<{ messages: { id: string; name: string; message: string; time: number; self?: boolean }[]; send: (text: string) => void; live: boolean } | null>(null);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const copilotAsk = trpc.copilot.ask.useMutation();
  const askCopilot = () => {
    if (!question.trim()) return;
    const prompt = question.trim();
    setQuestion("");
    setBusy(true);
    copilotAsk.mutate(
      {
        prompt,
        context: `The user is inside the ${meeting.title} meeting room. Status: ${meeting.status}. Date: ${meeting.date} ${meeting.time}. Answer only from the available workspace and meeting context, and tell the user when a generated transcript or summary is needed.\n${meetingContext ? `Meeting content (use this to answer):\n${meetingContext}` : "No transcript or summary has been generated for this meeting yet."}`.slice(0, 3900),
      },
      {
        onSuccess: (result) => setAnswer(result.reply),
        onError: () => setAnswer("I could not reach Copilot just now. Try again after the meeting transcript is ready."),
        onSettled: () => setBusy(false),
      },
    );
  };
  const seedTranscript = meeting.persistedId ? "" : "Maya: The launch flow is ready for the final quality pass.\nJordan: I will confirm the mobile edge cases today.\nShubham: Let’s keep October 4 as the target date.";

  return <div className="drawer-backdrop" onClick={onClose}><aside className="meeting-drawer" aria-label={`${meeting.title} meeting room`} onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow"><i className="pulse-dot" /> {meeting.status === "Live now" ? "Live meeting" : "Meeting details"}</span><h2>{meeting.title}</h2><p>{meeting.date} · {meeting.time} · {meeting.durationMinutes || 30} minutes · {meeting.participants} participants</p></div><button className="icon-button" onClick={onClose} aria-label="Close meeting room"><X size={18} /></button></div><div className="video-stage"><div className="video-gradient" /><div className="video-center"><span className="speaking-avatar">MN</span><strong>{meeting.status === "Live now" ? "Maya Nguyen is speaking" : "Your meeting room is ready"}</strong><small>{meeting.status === "Live now" ? "Product lead" : "Start the conversation when you are ready"}</small></div><div className="video-label"><span><i /> Maya Nguyen</span><span>01:24:18</span></div></div><LiveCall roomId={meeting.persistedId ? `meeting--${meeting.persistedId}` : `meeting-${meeting.id}`} displayName={displayName} onRecordingReady={setRecordedFile} onChatBridge={setChatBridge} onOpenAi={() => setExtrasOpen((open) => !open)} /><div className="meeting-controls"><button className={!mic ? "off" : ""} onClick={() => setMic(!mic)} title="Toggle microphone"><Mic2 size={17} /></button><button className={!camera ? "off" : ""} onClick={() => setCamera(!camera)} title="Toggle camera"><Video size={17} /></button><button className={!audio ? "off" : ""} onClick={() => setAudio(!audio)} title="Toggle audio"><Headphones size={17} /></button>{meeting.persistedId && meeting.status === "Upcoming" && <button className="meeting-cancel-link" onClick={() => { if (confirm("Cancel this scheduled meeting?")) onCancel(meeting.persistedId!); }}>Cancel</button>}<button className="invite-meeting-button" onClick={onInvite}><Users size={14} /> Invite</button><button className="end-button" onClick={onClose}>Leave</button></div><button type="button" className={`extras-fab${extrasOpen || chatBridge?.live ? " open" : ""}`} onClick={() => setExtrasOpen((open) => !open)} aria-label="Open meeting AI and room chat"><Bot size={15} /> AI & chat</button><div className={extrasOpen ? "drawer-extras floating" : "drawer-extras"}>{extrasOpen && <button type="button" className="secondary-button extras-close" onClick={() => setExtrasOpen(false)}><X size={14} /> Close</button>}<MeetingIntelligence meetingId={meeting.persistedId} title={meeting.title} seedTranscript={seedTranscript} incomingFile={recordedFile} onAddTasks={onAddTasks} onContextChange={setMeetingContext} /><div className="meeting-copilot"><h4>Ask the meeting copilot</h4>{answer && <p className="copilot-answer"><Bot size={14} /> {answer}</p>}<div className="copilot-input"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => event.key === "Enter" && askCopilot()} placeholder="What did we decide about...?" /><button onClick={askCopilot} disabled={busy} aria-label="Ask meeting Copilot"><WandSparkles size={15} /></button></div></div><div className="drawer-chat"><span className="drawer-section-label">Room notes (only you can see these · use the Chat button in the video call to message others)</span>{messages.slice(-3).map((item, index) => <div className="drawer-chat-row" key={`${item.name}-${index}`}><Avatar name={item.name} tone={item.tone} /><span><strong>{item.name}</strong><p>{item.text}</p></span></div>)}<div className="chat-input"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSend()} placeholder="Type a private note…" /><button className="send-button" onClick={onSend} aria-label="Add private note"><Send size={15} /></button></div></div></div></aside></div>;
}

function SearchModal({ query, setQuery, meetings, onClose, onNavigate, onOpen }: { query: string; setQuery: (query: string) => void; meetings: Meeting[]; onClose: () => void; onNavigate: (view: View) => void; onOpen: (meeting: Meeting) => void }) {
  const results = filterMeetings(meetings, query);
  return <Modal title="Search IntellMeet" subtitle="Find meetings, views, and action items." onClose={onClose}><label className="command-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anything..." /></label><div className="search-results">{query && results.map((meeting) => <button key={meeting.id} onClick={() => onOpen(meeting)}><Video size={16} /><span><strong>{meeting.title}</strong><small>{meeting.date} · {meeting.time}</small></span><ArrowUpRight size={14} /></button>)}<button onClick={() => onNavigate("tasks")}><Target size={16} /><span><strong>Open action items</strong><small>Review pending team work</small></span><ArrowUpRight size={14} /></button><button onClick={() => onNavigate("analytics")}><Activity size={16} /><span><strong>Team analytics</strong><small>Meeting load and collaboration health</small></span><ArrowUpRight size={14} /></button></div></Modal>;
}

function MeetingField({ label, ariaLabel, type, value, min, icon, onChange }: { label: string; ariaLabel: string; type: "date" | "time"; value: string; min?: string; icon: React.ReactNode; onChange: (value: string) => void }) {
  const displayValue = type === "date" ? dateLabel(value) : timeLabel(value);
  return <label className="meeting-field"><span>{label}</span><span className="field-control"><span className="field-button" aria-hidden="true">{icon}<span>{displayValue}</span><ChevronDown size={13} /></span><input className="field-input-overlay" aria-label={ariaLabel} type={type} min={min} step={type === "time" ? 900 : undefined} value={value} onChange={(event) => onChange(event.target.value)} onClick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} required /></span></label>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const focusable = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
    (modal.querySelector<HTMLElement>("[autofocus]") || focusable()[0])?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return <div className="modal-backdrop" onClick={onClose}><div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}><div className="modal-header"><span><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</span><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>{children}</div></div>;
}
