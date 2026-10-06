import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listMeetingsForOwner: vi.fn(),
  createMeetingForOwner: vi.fn(),
  getMeetingForOwner: vi.fn(),
  getMeetingById: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listMeetingsForOwner: dbMocks.listMeetingsForOwner,
    createMeetingForOwner: dbMocks.createMeetingForOwner,
    getMeetingForOwner: dbMocks.getMeetingForOwner,
    getMeetingById: dbMocks.getMeetingById,
  };
});

let appRouter: typeof import("./routers")["appRouter"];
let verifyHostToken: typeof import("./hostToken")["verifyHostToken"];

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "test-database-url";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-that-is-long-enough-for-local-tests";
  ({ appRouter } = await import("./routers"));
  ({ verifyHostToken } = await import("./hostToken"));
});

beforeEach(() => {
  vi.clearAllMocks();
});

const userContext = (openId: string) => ({
  user: { openId, id: 1, name: "Test User", email: "test@example.com", loginMethod: "local", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: {} as never,
  res: {} as never,
});
const meetingRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  ownerOpenId: "user-a",
  title: "Planning",
  description: null,
  scheduledAt: new Date(Date.now() + 60_000),
  durationMinutes: 30,
  status: "scheduled",
  createdAt: new Date(),
  ...overrides,
});

describe("meeting API", () => {
  it("returns no saved meetings for an anonymous visitor", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    await expect(caller.meetings.list({ cacheKey: "anonymous" })).resolves.toEqual([]);
    expect(dbMocks.listMeetingsForOwner).not.toHaveBeenCalled();
  });

  it("rejects anonymous meeting creation", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    await expect(caller.meetings.create({
      title: "Planning",
      scheduledAt: "2099-01-01T10:00:00.000Z",
      durationMinutes: 30,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dbMocks.createMeetingForOwner).not.toHaveBeenCalled();
  });

  it("lists only the current user's meetings", async () => {
    dbMocks.listMeetingsForOwner.mockResolvedValueOnce([
      { id: 7, ownerOpenId: "user-a", title: "Planning", description: null, scheduledAt: new Date("2099-01-01T10:00:00.000Z"), durationMinutes: 60, status: "scheduled", createdAt: new Date() },
    ]);
    const caller = appRouter.createCaller(userContext("user-a"));
    await expect(caller.meetings.list({ cacheKey: "user-a" })).resolves.toEqual([
      { id: 7, title: "Planning", description: null, scheduledAt: "2099-01-01T10:00:00.000Z", endsAt: "2099-01-01T11:00:00.000Z", durationMinutes: 60, roomId: "meeting--7", status: "scheduled" },
    ]);
    expect(dbMocks.listMeetingsForOwner).toHaveBeenCalledWith("user-a");
  });

  it("creates a future meeting using the authenticated owner, not client-supplied ownership", async () => {
    const scheduledAt = "2099-01-01T10:00:00.000Z";
    dbMocks.createMeetingForOwner.mockResolvedValueOnce({
      id: 11,
      ownerOpenId: "user-a",
      title: "Planning",
      description: null,
      scheduledAt: new Date(scheduledAt),
      durationMinutes: 45,
      status: "scheduled",
      createdAt: new Date(),
    });
    const caller = appRouter.createCaller(userContext("user-a"));
    await expect(caller.meetings.create({ title: " Planning ", scheduledAt, durationMinutes: 45 })).resolves.toEqual({
      id: 11,
      title: "Planning",
      description: null,
      scheduledAt,
      endsAt: "2099-01-01T10:45:00.000Z",
      durationMinutes: 45,
      roomId: "meeting--11",
      status: "scheduled",
    });
    expect(dbMocks.createMeetingForOwner).toHaveBeenCalledWith({
      ownerOpenId: "user-a",
      title: "Planning",
      description: null,
      scheduledAt: new Date(scheduledAt),
      durationMinutes: 45,
    });
  });

  it("rejects a meeting scheduled in the past", async () => {
    const caller = appRouter.createCaller(userContext("user-a"));
    await expect(caller.meetings.create({
      title: "Old meeting",
      scheduledAt: "2000-01-01T10:00:00.000Z",
      durationMinutes: 30,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.createMeetingForOwner).not.toHaveBeenCalled();
  });

  it("does not return a host token to an anonymous visitor", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as never, res: {} as never });
    await expect(caller.meetings.hostToken({ meetingId: 11 })).resolves.toEqual({ hostToken: null });
    expect(dbMocks.getMeetingForOwner).not.toHaveBeenCalled();
  });

  it("does not return a host token to a non-owner", async () => {
    dbMocks.getMeetingForOwner.mockResolvedValueOnce(undefined);
    const caller = appRouter.createCaller(userContext("user-b"));
    await expect(caller.meetings.hostToken({ meetingId: 11 })).resolves.toEqual({ hostToken: null });
    expect(dbMocks.getMeetingForOwner).toHaveBeenCalledWith(11, "user-b");
  });

  it("issues a signed host token to the owner of an active meeting", async () => {
    dbMocks.getMeetingForOwner.mockResolvedValueOnce(meetingRecord());
    const caller = appRouter.createCaller(userContext("user-a"));
    const result = await caller.meetings.hostToken({ meetingId: 11 });
    expect(result.hostToken).toEqual(expect.any(String));
    expect(verifyHostToken("meeting--11", result.hostToken)).toBe(true);
    expect(dbMocks.getMeetingForOwner).toHaveBeenCalledWith(11, "user-a");
  });

  it.each(["cancelled", "completed"] as const)("rejects a host token for a %s meeting", async status => {
    dbMocks.getMeetingForOwner.mockResolvedValueOnce(meetingRecord({ status }));
    const caller = appRouter.createCaller(userContext("user-a"));
    await expect(caller.meetings.hostToken({ meetingId: 11 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a host token for an expired meeting", async () => {
    dbMocks.getMeetingForOwner.mockResolvedValueOnce(meetingRecord({
      scheduledAt: new Date(Date.now() - 31 * 60_000),
    }));
    const caller = appRouter.createCaller(userContext("user-a"));
    await expect(caller.meetings.hostToken({ meetingId: 11 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects joining a meeting marked completed even if its scheduled end is in the future", async () => {
    dbMocks.getMeetingById.mockResolvedValueOnce(meetingRecord({ status: "completed" }));
    const caller = appRouter.createCaller(userContext("user-a"));
    await expect(caller.meetings.join({ meetingId: 11 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
