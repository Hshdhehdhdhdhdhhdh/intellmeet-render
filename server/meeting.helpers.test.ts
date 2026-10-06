import { describe, expect, it } from "vitest";
import { filterMeetings, initialMeetings } from "../client/src/pages/Home";

describe("IntellMeet meeting helpers", () => {
  it("ships with a demo schedule that covers live and upcoming meetings", () => {
    expect(initialMeetings).toHaveLength(4);
    expect(initialMeetings.some((meeting) => meeting.status === "Live now")).toBe(true);
    expect(initialMeetings.some((meeting) => meeting.status === "Upcoming")).toBe(true);
  });

  it("filters meeting titles case-insensitively and ignores surrounding whitespace", () => {
    expect(filterMeetings(initialMeetings, "  PRODUCT  ")).toHaveLength(1);
    expect(filterMeetings(initialMeetings, "research")[0]?.title).toBe("Customer research");
    expect(filterMeetings(initialMeetings, "does not exist")).toEqual([]);
    expect(filterMeetings(initialMeetings, "")).toHaveLength(initialMeetings.length);
  });
});
