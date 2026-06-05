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

  it("declares Chrome Web Store icon assets for the extension and toolbar action", () => {
    const source = readFileSync(join(process.cwd(), "src/manifest.ts"), "utf8");

    expect(source).toContain('"16": "icons/asset-inspector-16.png"');
    expect(source).toContain('"32": "icons/asset-inspector-32.png"');
    expect(source).toContain('"48": "icons/asset-inspector-48.png"');
    expect(source).toContain('"128": "icons/asset-inspector-128.png"');
    expect(source).toContain('default_icon:');
    expect(source).toContain('"24": "icons/asset-inspector-24.png"');
  });
});
