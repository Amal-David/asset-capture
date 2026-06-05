import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("extension manifest permissions", () => {
  it("keeps debugger access behind the deep-capture runtime prompt", () => {
    const source = readFileSync(join(process.cwd(), "src/manifest.ts"), "utf8");
    const requiredPermissions = source.match(/\bpermissions:\s*\[([\s\S]*?)\],/)?.[1] ?? "";

    expect(requiredPermissions).not.toContain('"debugger"');
    expect(source).toContain('optional_permissions: ["debugger"]');
  });
});
