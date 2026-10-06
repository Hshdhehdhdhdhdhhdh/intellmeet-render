import { describe, expect, it } from "vitest";
import { normalizeCopilotResult } from "./copilot";

describe("copilot action parsing", () => {
  it("keeps a navigate action with a valid workspace view", () => {
    const result = normalizeCopilotResult(
      {
        reply: "Opening analytics.",
        action: { type: "navigate", view: "analytics" },
      },
      "I could not complete that."
    );
    expect(result.reply).toBe("Opening analytics.");
    expect(result.action).toEqual({ type: "navigate", view: "analytics" });
  });

  it("falls back safely when the model returns an unknown action", () => {
    const result = normalizeCopilotResult(
      { reply: "Here is a summary.", action: { type: "explode", view: "secret" } },
      "I could not complete that."
    );
    expect(result.reply).toBe("Here is a summary.");
    expect(result.action).toEqual({ type: "none" });
  });

  it("uses the fallback reply when the model returns empty content", () => {
    const result = normalizeCopilotResult(null, "I could not complete that.");
    expect(result).toEqual({
      reply: "I could not complete that.",
      action: { type: "none" },
    });
  });
});
