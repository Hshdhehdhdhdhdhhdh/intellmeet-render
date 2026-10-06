import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing both Manus OAuth and local email/password auth.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier or generated local account identifier. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/** Local password credentials are separated from public user/profile fields. */
export const localAccounts = mysqlTable("local_accounts", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const meetings = mysqlTable("meetings", {
  id: int("id").autoincrement().primaryKey(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  scheduledAt: timestamp("scheduledAt").notNull(),
  durationMinutes: int("durationMinutes").notNull(),
  status: mysqlEnum("status", ["scheduled", "live", "completed", "cancelled"]).default("scheduled").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("meetings_owner_scheduled_at_idx").on(table.ownerOpenId, table.scheduledAt)]);

/** Durable index for files uploaded to project storage for Copilot analysis. */
export const copilotFiles = mysqlTable("copilot_files", {
  id: int("id").autoincrement().primaryKey(),
  publicId: varchar("publicId", { length: 36 }).notNull().unique(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }),
  name: varchar("name", { length: 240 }).notNull(),
  mimeType: varchar("mimeType", { length: 160 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  size: int("size").notNull(),
  extractedText: text("extractedText"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("copilot_files_owner_created_at_idx").on(table.ownerOpenId, table.createdAt)]);

export const meetingInsights = mysqlTable("meeting_insights", {
  id: int("id").autoincrement().primaryKey(),
  meetingId: int("meetingId").notNull(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
  transcript: text("transcript").notNull(),
  summary: text("summary").notNull(),
  decisionsJson: text("decisionsJson").notNull(),
  actionItemsJson: text("actionItemsJson").notNull(),
  language: varchar("language", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("meeting_insights_owner_meeting_unique").on(table.ownerOpenId, table.meetingId),
]);

export const meetingInvitations = mysqlTable("meeting_invitations", {
  id: int("id").autoincrement().primaryKey(),
  meetingId: int("meetingId").notNull(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("meeting_invitations_meeting_email_unique").on(table.meetingId, table.email),
  index("meeting_invitations_email_idx").on(table.email),
]);

export const supportTickets = mysqlTable("support_tickets", {
  id: int("id").autoincrement().primaryKey(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["open", "resolved"]).default("open").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("support_tickets_owner_created_at_idx").on(table.ownerOpenId, table.createdAt)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type LocalAccount = typeof localAccounts.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type CopilotFile = typeof copilotFiles.$inferSelect;
export type MeetingInsight = typeof meetingInsights.$inferSelect;
export type MeetingInvitation = typeof meetingInvitations.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
