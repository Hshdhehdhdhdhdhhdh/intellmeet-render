export type CopilotActionType =
  | "none"
  | "navigate"
  | "open_meeting"
  | "create_meeting"
  | "add_task"
  | "search"
  | "download_report"
  | "start_meeting";

export type CopilotView =
  | "overview"
  | "meetings"
  | "workspace"
  | "tasks"
  | "analytics"
  | "calendar"
  | "reports";

export type CopilotAction = {
  type: CopilotActionType;
  view?: CopilotView;
  query?: string;
  title?: string;
};

export type CopilotResult = {
  reply: string;
  action: CopilotAction;
};

export type CopilotAttachment = {
  uploadId: string;
  name: string;
  type: string;
};

const VIEWS: CopilotView[] = [
  "overview",
  "meetings",
  "workspace",
  "tasks",
  "analytics",
  "calendar",
  "reports",
];

const ACTIONS: CopilotActionType[] = [
  "none",
  "navigate",
  "open_meeting",
  "create_meeting",
  "add_task",
  "search",
  "download_report",
  "start_meeting",
];

function asView(value: unknown): CopilotView | undefined {
  return typeof value === "string" && VIEWS.includes(value as CopilotView)
    ? (value as CopilotView)
    : undefined;
}

function asActionType(value: unknown): CopilotActionType {
  return typeof value === "string" && ACTIONS.includes(value as CopilotActionType)
    ? (value as CopilotActionType)
    : "none";
}

export function normalizeCopilotResult(input: unknown, fallback: string): CopilotResult {
  const payload = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const actionRaw = (payload.action && typeof payload.action === "object"
    ? payload.action
    : {}) as Record<string, unknown>;
  const reply = typeof payload.reply === "string" && payload.reply.trim()
    ? payload.reply.trim()
    : fallback;
  const action: CopilotAction = {
    type: asActionType(actionRaw.type),
  };
  const view = asView(actionRaw.view);
  if (view) action.view = view;
  if (typeof actionRaw.query === "string" && actionRaw.query.trim()) action.query = actionRaw.query.trim();
  if (typeof actionRaw.title === "string" && actionRaw.title.trim()) action.title = actionRaw.title.trim();
  return { reply, action };
}

export const COPILOT_SYSTEM_PROMPT = `You are IntellMeet Copilot, an in-product AI assistant for Shubham Singh's meeting workspace.
Answer general questions clearly and helpfully, and use the workspace context and attached files when they are relevant. You can explain concepts, summarize or compare uploaded content, draft notes, and help with meeting planning. Never claim that a demo-only feature is backed by data unless the context says it is.
You can also search the workspace and run actions.
Always return JSON with:
- reply: a concise helpful answer in plain language
- action: an object with type and optional view, query, title

Allowed action.type values:
- none: just answer
- navigate: open a workspace view (view must be one of overview, meetings, workspace, tasks, analytics, calendar, reports)
- open_meeting: open a meeting by title in query or title
- create_meeting: create a meeting; put the meeting name in title
- add_task: add an action item; put the task text in title
- search: search meetings; put the search phrase in query
- download_report: download the workspace report
- start_meeting: open the new meeting form
Do not invent unrelated IntellMeet records. Prefer running a useful action when the user clearly asks to go, open, create, add, search, start, or download. For a normal question or file analysis request, use action type none and put the complete answer in reply.`;
