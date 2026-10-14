import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

const req = (url: string, method = "GET") => new NextRequest(url, { method });

describe("canonical host", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends production pages on a deployment URL to the canonical address", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "https://aop-inbox.vercel.app");
    const res = proxy(req("https://aop-inbox-abc123-team.vercel.app/login?next=%2Finbox"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://aop-inbox.vercel.app/login?next=%2Finbox");
  });

  it("leaves the canonical host, API calls and non-production alone", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "https://aop-inbox.vercel.app");
    expect(proxy(req("https://aop-inbox.vercel.app/login")).status).toBe(200);
    expect(proxy(req("https://aop-inbox-abc123-team.vercel.app/api/jobs/run")).status).toBe(200);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(proxy(req("https://aop-inbox-abc123-team.vercel.app/login")).status).toBe(200);
  });

  it("still sends signed-out visitors to sign in", () => {
    const res = proxy(req("http://localhost:3000/inbox"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Finbox");
  });
});
