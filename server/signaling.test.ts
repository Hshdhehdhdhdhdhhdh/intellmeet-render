import { describe, expect, it } from "vitest";
import { canSignalPeer, roomKind } from "./signaling";

function listPeers(roomIds: string[], selfId: string, names: Record<string, string>) {
  return roomIds
    .filter((id) => id !== selfId)
    .map((id) => ({ id, name: names[id] || "Guest" }));
}

describe("signaling occupants", () => {
  it("omits the joining socket and keeps display names", () => {
    const peers = listPeers(["a", "b", "self"], "self", { a: "Maya", b: "Jordan" });
    expect(peers).toEqual([
      { id: "a", name: "Maya" },
      { id: "b", name: "Jordan" },
    ]);
  });

  it("accepts only known public-demo and account-owned meeting room formats", () => {
    expect(roomKind("meeting-1")).toBe("demo");
    expect(roomKind("meeting-5")).toBe("demo");
    expect(roomKind("meeting-1790692373268")).toBe("demo");
    expect(roomKind("meeting-product-review")).toBe("demo");
    expect(roomKind("meeting--42")).toBe("account");
    expect(roomKind("private-room")).toBeNull();
    expect(roomKind("meeting--0")).toBeNull();
    expect(roomKind("meeting--42/other")).toBeNull();
  });

  it("rejects signaling across rooms or before joining one", () => {
    expect(canSignalPeer("meeting--42", "meeting--42")).toBe(true);
    expect(canSignalPeer("meeting--42", "meeting--43")).toBe(false);
    expect(canSignalPeer(undefined, "meeting--42")).toBe(false);
  });
});
