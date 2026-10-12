import { describe, expect, it } from "vitest";
import { safeNext } from "@/app/login/login-form";

const origin = "https://inbox.example.com";

describe("safeNext (post-login redirect)", () => {
  it.each(["//evil.com", "/\\evil.com", "https://evil.com/x", "javascript:alert(1)", "\\\\evil.com"])("rejects %s", (next) => {
    expect(safeNext(next, origin)).toBe("/");
  });
  it.each(["/.//evil.com", "/..//evil.com", "/%2e//evil.com"])("never returns a protocol-relative path for %s", (next) => {
    expect(safeNext(next, origin).startsWith("//")).toBe(false);
  });
  it("keeps same-origin paths with query", () => {
    expect(safeNext("/inbox?item=1", origin)).toBe("/inbox?item=1");
    expect(safeNext(null, origin)).toBe("/");
  });
});
