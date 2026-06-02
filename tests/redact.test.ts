import { describe, expect, it } from "vitest";
import { redactHeaders, redactUrl } from "../src/shared/redact";

describe("redaction", () => {
  it("redacts credentials and signed query material", () => {
    const result = redactUrl("https://user:pass@example.com/file.mp4?X-Amz-Signature=abc&safe=ok&token=secret");
    expect(result.value).toContain("safe=ok");
    expect(result.value).not.toContain("abc");
    expect(result.value).not.toContain("secret");
    expect(result.flags).toEqual(expect.arrayContaining(["credentials", "query:X-Amz-Signature", "query:token"]));
  });

  it("redacts sensitive headers and inline bearer tokens", () => {
    const result = redactHeaders({
      Authorization: "Bearer secret-token",
      Cookie: "sid=123",
      Accept: "application/json"
    });
    expect(result.value?.Authorization).toBe("[REDACTED]");
    expect(result.value?.Cookie).toBe("[REDACTED]");
    expect(result.value?.Accept).toBe("application/json");
    expect(result.flags).toEqual(expect.arrayContaining(["header:Authorization", "header:Cookie"]));
  });

  it("redacts high-confidence secret shapes hidden in header values", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36";
    const result = redactHeaders({
      "X-Trace": `note ${jwt} sk_live_abcdEFGH12345678 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345`
    });
    expect(result.value?.["X-Trace"]).not.toContain("eyJ");
    expect(result.value?.["X-Trace"]).not.toContain("sk_live_abcdEFGH");
    expect(result.value?.["X-Trace"]).not.toContain("ghp_ABCDEF");
    expect(result.flags).toEqual(expect.arrayContaining(["inline:jwt", "inline:provider-key", "inline:github-token"]));
  });
});
