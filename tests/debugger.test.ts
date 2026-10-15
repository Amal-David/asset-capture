// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

function event<T extends unknown[]>() {
  const listeners: Array<(...args: T) => void> = [];
  return { addListener: (fn: (...args: T) => void) => listeners.push(fn), emit: (...args: T) => listeners.forEach((fn) => fn(...args)) };
}
let stored: Record<string, unknown>;
let targets: Set<number>;
let api: ReturnType<typeof makeApi>;
function makeApi() {
  const onDetach = event<[{ tabId: number }, string]>();
  return {
    storage: { session: {
      get: vi.fn(async () => ({ ...stored })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); })
    } },
    permissions: { contains: vi.fn(async () => true), onRemoved: event<[{ permissions: string[] }]>() },
    tabs: { onUpdated: event<[number, { status: string }]>(), onRemoved: event<[number]>() },
    scripting: { executeScript: vi.fn(async () => []) },
    debugger: {
      onDetach,
      getTargets: vi.fn(async () => [...targets].map((tabId) => ({ tabId, attached: true }))),
      attach: vi.fn(async ({ tabId }: { tabId: number }) => { targets.add(tabId); }),
      detach: vi.fn(async ({ tabId }: { tabId: number }) => { targets.delete(tabId); onDetach.emit({ tabId }, "canceled_by_user"); }),
      sendCommand: vi.fn(async () => ({}))
    }
  };
}
beforeEach(() => { vi.resetModules(); stored = {}; targets = new Set(); api = makeApi(); vi.stubGlobal("chrome", api); });
afterEach(() => { vi.unstubAllGlobals(); });

it("restores only saved, still-owned attachments without reattaching", async () => {
  stored.deepCaptureTabIds = [1, 3];
  targets = new Set([1, 2]);
  const capture = await import("../src/background/debugger");
  await capture.debuggerReady;
  expect(await capture.getDeepCaptureState(1)).toBe(true);
  expect(await capture.getDeepCaptureState(2)).toBe(false);
  expect(stored.deepCaptureTabIds).toEqual([1]);
  expect(api.debugger.attach).not.toHaveBeenCalled();
  expect(api.debugger.sendCommand).toHaveBeenCalledTimes(1);
});

it("does not claim another debugger's attachment", async () => {
  stored.deepCaptureTabIds = [1]; targets.add(1);
  api.debugger.sendCommand.mockRejectedValue(new Error("Not attached by this extension"));
  const capture = await import("../src/background/debugger");
  await capture.debuggerReady;
  expect(await capture.getDeepCaptureState(1)).toBe(false);
  expect(api.debugger.detach).not.toHaveBeenCalled();
});

it("rolls back a failed initialization and serializes duplicate attaches", async () => {
  const capture = await import("../src/background/debugger");
  await capture.debuggerReady;
  api.debugger.sendCommand.mockRejectedValueOnce(new Error("Network unavailable"));
  await expect(capture.setDeepCapture(1, true)).rejects.toThrow("Network unavailable");
  expect(targets.has(1)).toBe(false);
  expect(stored.deepCaptureTabIds).toEqual([]);
  await Promise.all([capture.setDeepCapture(1, true), capture.setDeepCapture(1, true)]);
  expect(api.debugger.attach).toHaveBeenCalledTimes(2);
  expect(await capture.getDeepCaptureState(1)).toBe(true);
});

it("does not restore a tab that navigates during startup reconciliation", async () => {
  stored.deepCaptureTabIds = [1]; targets.add(1);
  let finish!: (value: Array<{ tabId: number; attached: boolean }>) => void;
  api.debugger.getTargets.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const capture = await import("../src/background/debugger");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  api.tabs.onUpdated.emit(1, { status: "loading" });
  finish([{ tabId: 1, attached: true }]);
  await capture.debuggerReady;
  expect(await capture.getDeepCaptureState(1)).toBe(false);
  expect(targets.has(1)).toBe(false);
  expect(stored.deepCaptureTabIds).toEqual([]);
});

it("rolls back an attachment that finishes after navigation", async () => {
  const capture = await import("../src/background/debugger");
  let finish!: () => void;
  api.debugger.attach.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = () => { targets.add(1); resolve(); }; }));
  const pending = capture.setDeepCapture(1, true);
  const rejected = expect(pending).rejects.toThrow("stopped while attaching");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  api.tabs.onUpdated.emit(1, { status: "loading" });
  finish();
  await rejected;
  expect(await capture.getDeepCaptureState(1)).toBe(false);
  expect(targets.has(1)).toBe(false);
});

it("finishes old page cleanup before starting another attachment", async () => {
  const capture = await import("../src/background/debugger");
  await capture.setDeepCapture(1, true);
  let finish!: () => void;
  api.scripting.executeScript.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve([]); }));
  api.debugger.onDetach.emit({ tabId: 1 }, "canceled_by_user");
  const reattached = capture.setDeepCapture(1, true);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(api.debugger.attach).toHaveBeenCalledTimes(1);
  finish();
  expect(await reattached).toBe(true);
  expect(api.debugger.attach).toHaveBeenCalledTimes(2);
});

it.each(["navigation", "detach", "permission", "close"])("invalidates body tokens and clears saved state on %s", async (kind) => {
  const capture = await import("../src/background/debugger");
  await capture.setDeepCapture(1, true);
  const token = capture.deepCaptureTabs.get(1);
  if (kind === "navigation") api.tabs.onUpdated.emit(1, { status: "loading" });
  if (kind === "detach") api.debugger.onDetach.emit({ tabId: 1 }, "canceled_by_user");
  if (kind === "permission") api.permissions.onRemoved.emit({ permissions: ["debugger"] });
  if (kind === "close") api.tabs.onRemoved.emit(1);
  expect(capture.deepCaptureTabs.get(1)).not.toBe(token);
  expect(await capture.getDeepCaptureState(1)).toBe(false);
  await vi.waitFor(() => expect(stored.deepCaptureTabIds).toEqual([]));
  expect(api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ func: expect.any(Function) }));
});
