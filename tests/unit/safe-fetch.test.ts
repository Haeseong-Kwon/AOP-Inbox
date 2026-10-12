import { describe, expect, it } from "vitest";
import { isPrivateAddress, safeFetch, UnsafeUrlError } from "@/lib/security/safe-fetch";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "[::1]", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("safeFetch", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost/",
    "http://example.com:8080/",
    "file:///etc/passwd",
    "http://user:pw@example.com/",
  ])("refuses %s before connecting", async (url) => {
    await expect(safeFetch(url)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
