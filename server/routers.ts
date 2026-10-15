import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type { LocalAccount } from "../drizzle/schema";
import { z } from "zod";
import * as db from "./db";
import { hashPassword, normalizeEmail, verifyPassword } from "./auth";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { createHostToken } from "./hostToken";
import { invokeLLM, type Message, type MessageContent } from "./_core/llm";
import { storageGetSignedUrl, storagePut } from "./storage";
import { COPILOT_SYSTEM_PROMPT, normalizeCopilotResult, type CopilotAttachment } from "./copilot";
import { meetingIntelligenceRouter } from "./meetingIntelligence";

const MAX_COPILOT_FILE_BYTES = 15 * 1024 * 1024;
const TEXT_FILE_PATTERN = /\.(csv|json|md|mdx|txt|xml|html|css|js|jsx|ts|tsx|yaml|yml|log)$/i;
const MODEL_FILE_TYPES = new Set([
  "application/pdf",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "video/mp4",
]);

async function extractPdfText(data: Buffer): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = (Array.isArray(text) ? text.join("\n") : text).replace(/\0/g, "").trim();
    return clean ? clean.slice(0, 24_000) : null;
  } catch (error) {
    console.error("[Copilot] PDF text extraction failed", error);
    return null;
  }
}

function isTextFile(name: string, type: string) {
  return type.startsWith("text/") || TEXT_FILE_PATTERN.test(name);
}

function parseCopilotContent(content: unknown) {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((part): part is { type: "text"; text: string } =>
              Boolean(part && typeof part === "object" && part.type === "text" && typeof part.text === "string"),
            )
            .map((part) => part.text)
            .join("\n")
        : "";
  if (!text.trim()) throw new Error("The AI service returned no answer.");
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace >= firstBrace
    ? withoutFence.slice(firstBrace, lastBrace + 1)
    : withoutFence;
  return JSON.parse(jsonText);
}

function ensureAuthEnvironment() {
  if (!ENV.databaseUrl || !ENV.cookieSecret.trim()) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Authentication is not configured. Set DATABASE_URL and JWT_SECRET in the deployment environment.",
    });
  }
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

async function startLocalSession(
  ctx: { req: Parameters<typeof getSessionCookieOptions>[0]; res: { cookie: (name: string, value: string, options: Record<string, unknown>) => void } },
  user: { openId: string; name: string | null }
) {
  const sessionToken = await sdk.signSession(
    {
      openId: user.openId,
      appId: ENV.appId || "intellmeet-local",
      name: user.name || "",
    },
    { expiresInMs: ONE_YEAR_MS }
  );
  ctx.res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(ctx.req),
    maxAge: ONE_YEAR_MS,
  });
}

const safeUser = (user: NonNullable<Awaited<ReturnType<typeof db.getUserByOpenId>>>) => ({
  id: user.id,
  openId: user.openId,
  name: user.name,
  email: user.email,
  loginMethod: user.loginMethod,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastSignedIn: user.lastSignedIn,
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    register: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(2, "Enter your full name.").max(100),
          email: z.string().trim().email().max(320),
          password: z.string().min(8, "Password must be at least 8 characters.").max(72)
            .refine((password) => new TextEncoder().encode(password).length <= 72, "Password cannot exceed 72 UTF-8 bytes."),
        })
      )
      .mutation(async ({ ctx, input }) => {
        ensureAuthEnvironment();
        const email = normalizeEmail(input.email);
        try {
          if (await db.emailAlreadyRegistered(email)) {
            throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists." });
          }
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          console.error("[Auth] Could not check account email", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Authentication database is unavailable. Please try again later." });
        }

        const openId = `local_${randomUUID().replaceAll("-", "")}`;
        const passwordHash = await hashPassword(input.password);
        try {
          await db.createLocalAccount({
            openId,
            name: input.name.trim(),
            email,
            passwordHash,
          });
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists." });
          }
          console.error("[Auth] Registration failed", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create your account. Please try again." });
        }

        const user = await db.getUserByOpenId(openId);
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account was created but could not be loaded." });
        await startLocalSession(ctx, user);
        return safeUser(user);
      }),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().email().max(320),
          password: z.string().min(1).max(72)
            .refine((password) => new TextEncoder().encode(password).length <= 72, "Password cannot exceed 72 UTF-8 bytes."),
        })
      )
      .mutation(async ({ ctx, input }) => {
        ensureAuthEnvironment();
        const email = normalizeEmail(input.email);
        let account: LocalAccount | undefined;
        try {
          account = await db.getLocalAccountByEmail(email);
        } catch (error) {
          console.error("[Auth] Could not load account", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Authentication database is unavailable. Please try again later." });
        }
        if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is incorrect." });
        }

        await db.upsertUser({ openId: account.openId, lastSignedIn: new Date() });
        const user = await db.getUserByOpenId(account.openId);
        if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is incorrect." });
        await startLocalSession(ctx, user);
        return safeUser(user);
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updateProfile: publicProcedure
      .input(z.object({ name: z.string().trim().min(2, "Enter your full name.").max(100) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to update your profile." });
        const user = await db.updateUserProfile(ctx.user.openId, { name: input.name.trim() });
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });
        return safeUser(user);
      }),
  }),
  support: router({
    create: publicProcedure
      .input(z.object({
        name: z.string().trim().min(2).max(100),
        email: z.string().trim().email().max(320),
        category: z.enum(["account", "meeting", "transcription", "copilot", "billing", "other"]),
        message: z.string().trim().min(20, "Please include at least 20 characters.").max(5000),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createSupportTicket({
          ownerOpenId: ctx.user?.openId || null,
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          category: input.category,
          message: input.message.trim(),
        });
        if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the support request." });
        return { id, status: "open" as const };
      }),
  }),
  meetingIntelligence: meetingIntelligenceRouter,
  meetings: router({
    list: publicProcedure
      // This input partitions the browser's query cache; it is never used as an owner identifier.
      .input(z.object({ cacheKey: z.string().max(64) }))
      .query(async ({ ctx }) => {
      if (!ctx.user) return [];
      try {
        const records = await db.listMeetingsForOwner(ctx.user.openId);
        return records.map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          description: meeting.description,
          scheduledAt: meeting.scheduledAt.toISOString(),
          endsAt: new Date(meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000).toISOString(),
          durationMinutes: meeting.durationMinutes,
          roomId: `meeting--${meeting.id}`,
          status: meeting.status === "cancelled" ? "cancelled" : (Date.now() >= meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000 ? "completed" : (Date.now() >= meeting.scheduledAt.getTime() ? "live" : "scheduled")),
        }));
      } catch (error) {
        console.error("[Meetings] Could not load meetings", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not load saved meetings." });
      }
    }),
    create: publicProcedure
      .input(z.object({
        title: z.string().trim().min(1, "Enter a meeting title.").max(200),
        description: z.string().trim().max(2000).optional(),
        scheduledAt: z.string().datetime(),
        durationMinutes: z.number().int().min(15).max(240),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to save meetings to your account." });
        }
        ensureAuthEnvironment();
        const scheduledAt = new Date(input.scheduledAt);
        if (scheduledAt.getTime() <= Date.now()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a future date and time." });
        }
        try {
          const meeting = await db.createMeetingForOwner({
            ownerOpenId: ctx.user.openId,
            title: input.title.trim(),
            description: input.description?.trim() || null,
            scheduledAt,
            durationMinutes: input.durationMinutes,
          });
          return {
            id: meeting.id,
            title: meeting.title,
            description: meeting.description,
            scheduledAt: meeting.scheduledAt.toISOString(),
            endsAt: new Date(meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000).toISOString(),
            durationMinutes: meeting.durationMinutes,
            roomId: `meeting--${meeting.id}`,
            status: "scheduled" as const,
          };
        } catch (error) {
          console.error("[Meetings] Could not create meeting", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not save this meeting. Check the database configuration and migration." });
        }
      }),
    cancel: publicProcedure
      .input(z.object({ meetingId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to cancel a meeting." });
        const meeting = await db.getMeetingForOwner(input.meetingId, ctx.user.openId);
        if (!meeting) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
        if (meeting.status === "completed" || Date.now() >= meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Completed meetings cannot be cancelled." });
        }
        await db.cancelMeetingForOwner(input.meetingId, ctx.user.openId);
        return { success: true, meetingId: input.meetingId, status: "cancelled" as const };
      }),
    join: publicProcedure
      .input(z.object({ meetingId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const meeting = await db.getMeetingById(input.meetingId);
        if (!meeting) throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found." });
        if (meeting.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This meeting has been cancelled." });
        if (meeting.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "This meeting has already completed." });
        const start = meeting.scheduledAt.getTime();
        const end = start + meeting.durationMinutes * 60_000;
        if (Date.now() > end) throw new TRPCError({ code: "BAD_REQUEST", message: "This meeting has already completed." });
        return { id: meeting.id, title: meeting.title, roomId: `meeting--${meeting.id}`, status: Date.now() >= start ? "live" as const : "scheduled" as const };
      }),
    hostToken: publicProcedure
      .input(z.object({ meetingId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        // Only the signed-in OWNER of a saved meeting receives a host token.
        if (!ctx.user) return { hostToken: null as string | null };
        const owned = await db.getMeetingForOwner(input.meetingId, ctx.user.openId);
        if (!owned) return { hostToken: null as string | null };
        if (owned.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "This meeting has been cancelled." });
        const end = owned.scheduledAt.getTime() + owned.durationMinutes * 60_000;
        if (owned.status === "completed" || Date.now() > end) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This meeting has already completed." });
        }
        return { hostToken: createHostToken(`meeting--${input.meetingId}`) };
      }),
    invite: publicProcedure
      .input(z.object({
        meetingId: z.number().int().positive(),
        email: z.string().trim().email().max(320),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to invite a teammate." });
        const invite = await db.inviteAccountToMeeting(input.meetingId, ctx.user.openId, input.email);
        if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Only the meeting owner can invite teammates." });
        return { ...invite, joinPath: `/call/meeting--${input.meetingId}` };
      }),
  }),
  copilot: router({
    upload: publicProcedure
      .input(z.object({
        name: z.string().trim().min(1).max(240),
        type: z.string().trim().max(160),
        data: z.string().min(1).max(24_000_000),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          if (!ENV.databaseUrl) {
            throw new Error("The upload database is not configured.");
          }
          const data = Buffer.from(input.data, "base64");
          if (data.length === 0 || data.length > MAX_COPILOT_FILE_BYTES) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Files must be smaller than 15 MB." });
          }
          const safeName = input.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-180) || "upload";
          const mimeType = input.type || "application/octet-stream";
          const stored = await storagePut(
            `copilot/${ctx.user?.openId || "anonymous"}/${safeName}`,
            data,
            mimeType,
          );
          const uploadId = randomUUID();
          const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(input.name);
          const extractedText = isTextFile(input.name, mimeType)
            ? data.toString("utf8").replace(/\0/g, "").slice(0, 24_000)
            : isPdf
              ? await extractPdfText(data)
              : null;
          await db.createCopilotFile({
            publicId: uploadId,
            ownerOpenId: ctx.user?.openId || null,
            name: input.name,
            mimeType,
            storageKey: stored.key,
            size: data.length,
            extractedText,
          });
          return { uploadId, name: input.name, type: mimeType, size: data.length, url: stored.url };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          console.error("[Copilot] File upload failed", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not upload that file. Please try again." });
        }
      }),
    ask: publicProcedure
      .input(
        z.object({
          prompt: z.string().trim().min(1, "Enter a question or command.").max(2000),
          context: z.string().trim().max(4000).optional(),
          attachments: z.array(z.object({
            uploadId: z.string().uuid(),
            name: z.string().trim().min(1).max(240),
            type: z.string().trim().max(160),
          })).max(5).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const userName = ctx.user?.name || "Shubham Singh";
        const fallback = "I can search meetings, open workspace views, create a meeting, add a task, or download the report.";
        try {
          const attachments = (input.attachments || []) as CopilotAttachment[];
          const userContent: MessageContent[] = [
            {
              type: "text",
              text: `Signed-in user: ${userName}${ctx.user?.email ? ` (${ctx.user.email})` : ""}.
Workspace context:
${input.context || "Overview, meetings, workspace, tasks, analytics, calendar, and reports are available."}

User request:
${input.prompt}`,
            },
          ];
          for (const attachment of attachments) {
            const file = await db.getCopilotFile(attachment.uploadId);
            const expectedOwner = ctx.user?.openId || null;
            if (!file || file.ownerOpenId !== expectedOwner) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `The attachment ${attachment.name} is no longer available.` });
            }
            if (file.extractedText?.trim()) {
              userContent.push({
                type: "text",
                text: `Attached file: ${file.name}\nFile contents:\n${file.extractedText.slice(0, 24_000)}`,
              });
              continue;
            }
            if (file.mimeType.startsWith("image/")) {
              const url = await storageGetSignedUrl(file.storageKey);
              userContent.push({ type: "image_url", image_url: { url, detail: "auto" } });
            } else if (MODEL_FILE_TYPES.has(file.mimeType)) {
              const url = await storageGetSignedUrl(file.storageKey);
              userContent.push({ type: "file_url", file_url: { url, mime_type: file.mimeType } });
            } else {
              userContent.push({
                type: "text",
                text: `Attached file uploaded successfully: ${file.name} (${file.mimeType}). Its format cannot be analyzed directly. Explain that limitation and ask for a text, PDF, image, MP3, WAV, M4A, or MP4 version.`,
              });
            }
          }
          const baseRequest = {
            messages: [
              { role: "system", content: COPILOT_SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ] as Message[],
          };
          let response = await invokeLLM({
            ...baseRequest,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "copilot_result",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    reply: { type: "string" },
                    action: {
                      type: "object",
                      properties: {
                        type: {
                          type: "string",
                          enum: ["none", "navigate", "open_meeting", "create_meeting", "add_task", "search", "download_report", "start_meeting"],
                        },
                        view: {
                          type: "string",
                          enum: ["overview", "meetings", "workspace", "tasks", "analytics", "calendar", "reports"],
                        },
                        query: { type: "string" },
                        title: { type: "string" },
                      },
                      required: ["type", "view", "query", "title"],
                      additionalProperties: false,
                    },
                  },
                  required: ["reply", "action"],
                  additionalProperties: false,
                },
              },
            },
          });
          let parsed: unknown;
          try {
            parsed = parseCopilotContent(response.choices[0]?.message?.content);
          } catch {
            response = await invokeLLM(baseRequest);
            parsed = parseCopilotContent(response.choices[0]?.message?.content);
          }
          return normalizeCopilotResult(parsed, fallback);
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          console.error("[Copilot] Could not complete request", error);
          return {
            reply: "I could not reach the AI service just now, but I can still open meetings, tasks, analytics, or start a new meeting from here.",
            action: { type: "none" as const },
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
