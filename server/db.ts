import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { copilotFiles, InsertUser, localAccounts, meetingInsights, meetingInvitations, meetings, supportTickets, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL || "";
}

// Lazily create a bounded pool so missing/unreachable production databases fail fast.
export async function getDb() {
  if (!_db && databaseUrl()) {
    try {
      const separator = databaseUrl().includes("?") ? "&" : "?";
      const boundedUrl = `${databaseUrl()}${separator}connectTimeout=8000&waitForConnections=true&connectionLimit=10&queueLimit=0`;
      _db = drizzle(boundedUrl);
    } catch (error) {
      console.warn("[Database] Failed to initialize:", error);
      _db = null;
    }
  }
  return _db;
}

export async function checkDatabaseConnection() {
  const db = await getDb();
  if (!db) return { ok: false, reason: "DATABASE_URL is not configured" };
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true as const };
  } catch (error) {
    console.warn("[Database] Health check failed:", error);
    return { ok: false, reason: "database connection failed" };
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getLocalAccountByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const result = await db
    .select()
    .from(localAccounts)
    .where(eq(localAccounts.email, email))
    .limit(1);
  return result[0];
}

export async function createLocalAccount(input: {
  openId: string;
  name: string;
  email: string;
  passwordHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      openId: input.openId,
      name: input.name,
      email: input.email,
      loginMethod: "email",
      role: "user",
      lastSignedIn: now,
    });
    await tx.insert(localAccounts).values({
      openId: input.openId,
      email: input.email,
      passwordHash: input.passwordHash,
    });
  });
}

export async function emailAlreadyRegistered(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const result = await db
    .select({ id: localAccounts.id })
    .from(localAccounts)
    .where(eq(localAccounts.email, email))
    .limit(1);
  return result.length > 0;
}

export async function listMeetingsForOwner(ownerOpenId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  return db
    .select()
    .from(meetings)
    .where(eq(meetings.ownerOpenId, ownerOpenId))
    .orderBy(asc(meetings.scheduledAt));
}

export async function createMeetingForOwner(input: {
  ownerOpenId: string;
  title: string;
  description?: string | null;
  scheduledAt: Date;
  durationMinutes: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const inserted = await db.insert(meetings).values(input).$returningId();
  const id = inserted[0]?.id;
  if (!id) throw new Error("Meeting was not created.");
  const result = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!result[0]) throw new Error("Meeting was created but could not be loaded.");
  return result[0];
}

export async function cancelMeetingForOwner(meetingId: number, ownerOpenId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  await db.update(meetings).set({ status: "cancelled" }).where(and(eq(meetings.id, meetingId), eq(meetings.ownerOpenId, ownerOpenId)));
}

export async function getMeetingById(meetingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const result = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  return result[0];
}

export async function createCopilotFile(input: {
  publicId: string;
  ownerOpenId: string | null;
  name: string;
  mimeType: string;
  storageKey: string;
  size: number;
  extractedText: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  await db.insert(copilotFiles).values(input);
  const result = await db
    .select()
    .from(copilotFiles)
    .where(eq(copilotFiles.publicId, input.publicId))
    .limit(1);
  if (!result[0]) throw new Error("Upload metadata could not be loaded.");
  return result[0];
}

export async function getCopilotFile(publicId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const result = await db
    .select()
    .from(copilotFiles)
    .where(eq(copilotFiles.publicId, publicId))
    .limit(1);
  return result[0];
}

export async function updateUserProfile(openId: string, input: { name: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  await db.update(users).set({ name: input.name }).where(eq(users.openId, openId));
  return getUserByOpenId(openId);
}

export async function getMeetingForOwner(meetingId: number, ownerOpenId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const result = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.ownerOpenId, ownerOpenId)))
    .limit(1);
  return result[0];
}

export async function inviteAccountToMeeting(meetingId: number, ownerOpenId: string, email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const meeting = await getMeetingForOwner(meetingId, ownerOpenId);
  if (!meeting) return null;
  const normalized = email.trim().toLowerCase();
  await db.insert(meetingInvitations).values({ meetingId, ownerOpenId, email: normalized }).onDuplicateKeyUpdate({
    set: { email: normalized },
  });
  return { meetingId, email: normalized };
}

export async function canAccountJoinMeeting(meetingId: number, openId: string, email: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const meeting = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting[0]) return false;
  if (meeting[0].status === "cancelled") return false;
  if (Date.now() > meeting[0].scheduledAt.getTime() + meeting[0].durationMinutes * 60_000) return false;
  if (meeting[0].ownerOpenId === openId) return true;
  if (!email) return false;
  const invite = await db.select({ id: meetingInvitations.id }).from(meetingInvitations)
    .where(and(eq(meetingInvitations.meetingId, meetingId), eq(meetingInvitations.email, email.toLowerCase())))
    .limit(1);
  return Boolean(invite[0]);
}

export async function saveMeetingInsight(input: {
  meetingId: number;
  ownerOpenId: string;
  transcript: string;
  summary: string;
  decisionsJson: string;
  actionItemsJson: string;
  language: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  await db.insert(meetingInsights).values(input).onDuplicateKeyUpdate({
    set: {
      transcript: input.transcript,
      summary: input.summary,
      decisionsJson: input.decisionsJson,
      actionItemsJson: input.actionItemsJson,
      language: input.language,
      updatedAt: new Date(),
    },
  });
  return getMeetingInsight(input.meetingId, input.ownerOpenId);
}

export async function getMeetingInsight(meetingId: number, ownerOpenId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const result = await db
    .select()
    .from(meetingInsights)
    .where(and(eq(meetingInsights.meetingId, meetingId), eq(meetingInsights.ownerOpenId, ownerOpenId)))
    .limit(1);
  return result[0];
}

export async function createSupportTicket(input: {
  ownerOpenId: string | null;
  name: string;
  email: string;
  category: string;
  message: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured. Set DATABASE_URL.");
  const inserted = await db.insert(supportTickets).values(input).$returningId();
  return inserted[0]?.id;
}
