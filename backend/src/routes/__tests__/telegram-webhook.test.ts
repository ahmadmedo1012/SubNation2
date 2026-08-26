import { describe, it, expect } from "vitest";
import { parseTopupCallback } from "../../routes/telegram-webhook";

describe("parseTopupCallback", () => {
  it("parses approve actions", () => {
    expect(parseTopupCallback("topup_app:3")).toEqual({ action: "approve", topupId: 3 });
  });

  it("parses reject actions", () => {
    expect(parseTopupCallback("topup_rej:12345")).toEqual({ action: "reject", topupId: 12345 });
  });

  it("rejects unknown actions", () => {
    expect(parseTopupCallback("sub_app:3")).toBeNull();
    expect(parseTopupCallback("topup_del:3")).toBeNull();
  });

  it("rejects non-numeric / non-positive ids", () => {
    expect(parseTopupCallback("topup_app:abc")).toBeNull();
    expect(parseTopupCallback("topup_app:0")).toBeNull();
    expect(parseTopupCallback("topup_app:-5")).toBeNull();
  });

  it("rejects missing/malformed data", () => {
    expect(parseTopupCallback(undefined)).toBeNull();
    expect(parseTopupCallback("")).toBeNull();
    expect(parseTopupCallback("topup_app:")).toBeNull();
    expect(parseTopupCallback("just-text")).toBeNull();
  });
});
