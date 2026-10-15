import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "../src/shared/messages";
import type { RuntimeResponse } from "../src/shared/messages";
import type { SessionSnapshot } from "../src/shared/types";
import { useInspectorStore } from "../src/sidepanel/store";

vi.mock("../src/shared/messages", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage);
const snapshot = (tabId: number): SessionSnapshot => ({
  sessionId: `tab-${tabId}`, assets: [], requests: [], blobs: [], media: [], deepCaptureAttached: false
});

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ ok: true, snapshot: snapshot(1) });
  useInspectorStore.setState(useInspectorStore.getInitialState(), true);
});

describe("inspector refresh", () => {
  it.each(["clear", "rescan"] as const)("does not switch back when an old tab's %s finishes", async (action) => {
    await useInspectorStore.getState().refresh(1);
    let finish!: (response: RuntimeResponse) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = useInspectorStore.getState()[action](1);
    send.mockResolvedValueOnce({ ok: true, snapshot: snapshot(2) });
    await useInspectorStore.getState().refresh(2);
    finish({ ok: true });
    await pending;
    expect(useInspectorStore.getState().snapshot?.sessionId).toBe("tab-2");
    expect(send.mock.calls.at(-1)?.[0]).toEqual({ type: "GET_SNAPSHOT", tabId: 2 });
  });
  it("ignores a previous tab's late response", async () => {
    let finishOld!: (response: RuntimeResponse) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const old = useInspectorStore.getState().refresh(1);
    send.mockResolvedValueOnce({ ok: true, snapshot: snapshot(2) });
    await useInspectorStore.getState().refresh(2);
    finishOld({ ok: true, snapshot: snapshot(1) });
    await old;
    expect(useInspectorStore.getState().snapshot?.sessionId).toBe("tab-2");
  });

  it("does not queue background polls while a snapshot is pending", async () => {
    let finish!: (response: RuntimeResponse) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = useInspectorStore.getState().refresh(1);
    await useInspectorStore.getState().refresh(1, true);
    expect(send).toHaveBeenCalledTimes(1);
    finish({ ok: true, snapshot: snapshot(1) });
    await pending;
  });

  it("clears stale selection when a session becomes empty", async () => {
    useInspectorStore.setState({ selectedIds: new Set(["old-asset"]) });
    send.mockResolvedValueOnce({ ok: true, snapshot: snapshot(1) });
    await useInspectorStore.getState().refresh(1);
    expect(useInspectorStore.getState().selectedIds.size).toBe(0);
  });

  it("removes the previous tab's data while loading another tab", async () => {
    send.mockResolvedValueOnce({ ok: true, snapshot: snapshot(1) });
    await useInspectorStore.getState().refresh(1);
    useInspectorStore.setState({ selectedIds: new Set(["old"]), pickerActive: true });
    let finish!: (response: RuntimeResponse) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = useInspectorStore.getState().refresh(2);
    expect(useInspectorStore.getState().snapshot).toBeUndefined();
    expect(useInspectorStore.getState().selectedIds.size).toBe(0);
    expect(useInspectorStore.getState().pickerActive).toBe(false);
    finish({ ok: true, snapshot: snapshot(2) });
    await pending;
  });
});
