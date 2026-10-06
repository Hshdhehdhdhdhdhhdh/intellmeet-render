import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { ENV } from "./_core/env";
import { invokeLLM, type Message } from "./_core/llm";
import { publicProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const AUDIO_TYPES = new Set([
  "audio/webm",
  "video/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
]);
const EXTENSION_TYPES: Record<string, string> = {
  webm: "audio/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

export type MeetingActionItem = {
  task: string;
  owner: string;
  due: string;
};

function inferAudioType(name: string, supplied: string) {
  const normalized = supplied.toLowerCase().split(";")[0].trim();
  if (AUDIO_TYPES.has(normalized)) return normalized;
  const extension = name.toLowerCase().split(".").pop() || "";
  return EXTENSION_TYPES[extension] || "";
}

function parseJsonContent(content: unknown) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) throw new Error("The AI service returned no meeting insight.");
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  return JSON.parse(start >= 0 && end >= start ? withoutFence.slice(start, end + 1) : withoutFence);
}

function normalizeInsight(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const decisions = Array.isArray(input.decisions)
    ? input.decisions.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 10)
    : [];
  const actionItems = Array.isArray(input.actionItems)
    ? input.actionItems.flatMap((item): MeetingActionItem[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const task = typeof record.task === "string" ? record.task.trim() : "";
        if (!task) return [];
        return [{
          task,
          owner: typeof record.owner === "string" && record.owner.trim() ? record.owner.trim() : "Unassigned",
          due: typeof record.due === "string" && record.due.trim() ? record.due.trim() : "Not specified",
        }];
      }).slice(0, 20)
    : [];
  if (!summary) throw new Error("The AI service returned an empty summary.");
  return { summary, decisions, actionItems };
}

export const meetingIntelligenceRouter = router({
  get: publicProcedure
    .input(z.object({ meetingId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) return null;
      const meeting = await db.getMeetingForOwner(input.meetingId, ctx.user.openId);
      if (!meeting) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
      const insight = await db.getMeetingInsight(input.meetingId, ctx.user.openId);
      if (!insight) return null;
      return {
        transcript: insight.transcript,
        summary: insight.summary,
        decisions: JSON.parse(insight.decisionsJson) as string[],
        actionItems: JSON.parse(insight.actionItemsJson) as MeetingActionItem[],
        language: insight.language,
        updatedAt: insight.updatedAt.toISOString(),
        persisted: true,
      };
    }),

  transcribe: publicProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(240),
      type: z.string().trim().max(160),
      data: z.string().min(1).max(24_000_000),
      meetingTitle: z.string().trim().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Transcription is not configured." });
      }
      const mimeType = inferAudioType(input.name, input.type);
      if (!mimeType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use a WebM, MP3, WAV, OGG, or M4A audio file." });
      }
      const data = Buffer.from(input.data, "base64");
      if (!data.length || data.length > MAX_AUDIO_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Audio files must be smaller than 15 MB." });
      }
      const safeName = input.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-180) || "meeting-audio.webm";
      const stored = await storagePut(`meeting-intelligence/${ctx.user?.openId || "anonymous"}/${safeName}`, data, mimeType);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), safeName);
      form.append("model", "whisper-1");
      form.append("prompt", `Transcribe this IntellMeet recording accurately. Meeting: ${input.meetingTitle}. Preserve names, dates, decisions, owners, and action items.`);
      const response = await fetch(`${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
        body: form,
      });
      const body = await response.json().catch(() => ({})) as {
        text?: string;
        language?: string;
        duration?: number;
        segments?: Array<{ id?: number; start?: number; end?: number; text?: string }>;
        error?: { message?: string } | string;
      };
      if (!response.ok || body.error) {
        console.error("[Meeting intelligence] Transcription failed", response.status, body.error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The recording could not be transcribed. Try a clearer supported audio file." });
      }
      const transcript = body.text?.trim() || "";
      if (!transcript) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No speech was detected in that recording." });
      }
      return {
        transcript,
        language: body.language || null,
        duration: typeof body.duration === "number" ? body.duration : null,
        segments: (body.segments || []).slice(0, 500).map((segment) => ({
          id: segment.id ?? null,
          start: segment.start ?? null,
          end: segment.end ?? null,
          text: segment.text || "",
        })),
        storageUrl: stored.url,
      };
    }),

  analyze: publicProcedure
    .input(z.object({
      meetingId: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(200),
      transcript: z.string().trim().min(10, "Add or transcribe more meeting content first.").max(100_000),
      language: z.string().trim().max(32).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.meetingId) {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to save meeting intelligence." });
        const meeting = await db.getMeetingForOwner(input.meetingId, ctx.user.openId);
        if (!meeting) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
      }
      const messages: Message[] = [
        {
          role: "system",
          content: "You are IntellMeet Meeting Intelligence. Turn a transcript into an accurate concise summary, explicit decisions, and actionable tasks. Do not invent facts. If an owner or due date is absent, use Unassigned or Not specified.",
        },
        {
          role: "user",
          content: `Meeting: ${input.title}\n\nTranscript:\n${input.transcript}`,
        },
      ];
      const request = {
        model: "gpt-5-mini",
        messages,
        response_format: {
          type: "json_schema" as const,
          json_schema: {
            name: "meeting_intelligence",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
                decisions: { type: "array", items: { type: "string" } },
                actionItems: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      task: { type: "string" },
                      owner: { type: "string" },
                      due: { type: "string" },
                    },
                    required: ["task", "owner", "due"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "decisions", "actionItems"],
              additionalProperties: false,
            },
          },
        },
      };
      let response = await invokeLLM(request);
      let parsed: unknown;
      try {
        parsed = parseJsonContent(response.choices[0]?.message?.content);
      } catch {
        response = await invokeLLM({ model: request.model, messages });
        parsed = parseJsonContent(response.choices[0]?.message?.content);
      }
      const insight = normalizeInsight(parsed);
      let persisted = false;
      if (ctx.user && input.meetingId) {
        await db.saveMeetingInsight({
          meetingId: input.meetingId,
          ownerOpenId: ctx.user.openId,
          transcript: input.transcript,
          summary: insight.summary,
          decisionsJson: JSON.stringify(insight.decisions),
          actionItemsJson: JSON.stringify(insight.actionItems),
          language: input.language || null,
        });
        persisted = true;
      }
      return { ...insight, transcript: input.transcript, language: input.language || null, persisted };
    }),
});
