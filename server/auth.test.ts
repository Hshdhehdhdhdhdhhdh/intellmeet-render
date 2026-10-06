import { describe, expect, it } from "vitest";
import { hashPassword, normalizeEmail, verifyPassword } from "./auth";

describe("local account credentials", () => {
  it("stores a bcrypt hash rather than the raw password", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("incorrect password", hash)).toBe(false);
  });

  it("rejects malformed hashes safely", async () => {
    expect(await verifyPassword("password", "not-a-hash")).toBe(false);
  });

  it("normalizes email addresses consistently", () => {
    expect(normalizeEmail("  Member@Example.COM ")).toBe("member@example.com");
  });
});
