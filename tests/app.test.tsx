import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/sidepanel/App";
import { useInspectorStore } from "../src/sidepanel/store";
import type { AssetRecord, SessionSnapshot } from "../src/shared/types";

const asset = (id: string, kind: AssetRecord["kind"]): AssetRecord => ({
  id, kind, sessionId: "tab-1", tabId: 1, url: `https://example.com/${id}`,
  sources: ["dom"], previewAvailable: false, redactionFlags: [], createdAt: 1, updatedAt: 1
});
const assets = [asset("a", "binary"), asset("b", "script")];
const snapshot: SessionSnapshot = { sessionId: "tab-1", assets, blobs: [], media: [], requests: [], deepCaptureAttached: false };
let root: Root;
let container: HTMLDivElement;
let onActivated: (info: { tabId: number; windowId: number }) => void;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  send = vi.fn((message, callback) => callback({ ok: true, snapshot: { ...snapshot, sessionId: `tab-${message.tabId}` } }));
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send },
    tabs: {
      query: (_query: unknown, callback: (tabs: unknown[]) => void) => callback([{ id: 1, windowId: 10 }]),
      onActivated: { addListener: (listener: typeof onActivated) => { onActivated = listener; }, removeListener: vi.fn() }
    }
  });
  useInspectorStore.setState(useInspectorStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps a successfully decoded video preview after the probe timeout", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const video = asset("video.mp4", "video");
  const videoSnapshot = { ...snapshot, assets: [video] };
  send.mockImplementation((_message, callback) => callback({ ok: true, snapshot: videoSnapshot }));
  const createElement = document.createElement.bind(document);
  let probe: HTMLVideoElement | undefined;
  vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
    const element = createElement(tag, options);
    if (tag === "video" && !probe) probe = element as HTMLVideoElement;
    return element;
  });
  await act(async () => useInspectorStore.setState({ snapshot: videoSnapshot }));
  await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click());
  await act(async () => probe!.dispatchEvent(new Event("loadeddata")));
  expect(container.querySelector("video")).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(13000));
  expect(container.querySelector("video")).not.toBeNull();
  expect(container.textContent).not.toContain("Couldn't render preview");
});

it("follows active tabs in its window, while ignoring other windows", async () => {
  expect(onActivated).toBeTypeOf("function");
  await act(async () => onActivated({ tabId: 2, windowId: 10 }));
  expect(useInspectorStore.getState().snapshot?.sessionId).toBe("tab-2");
  await act(async () => onActivated({ tabId: 3, windowId: 20 }));
  expect(useInspectorStore.getState().snapshot?.sessionId).toBe("tab-2");
});

it("exports exactly the visible selection advertised by the bulk toolbar", async () => {
  await act(async () => useInspectorStore.setState({ selectedIds: new Set(["a", "b"]), kinds: new Set(["binary"]) }));
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Export ZIP")!;
  await act(async () => button.click());
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "EXPORT", selectedIds: ["a"] }), expect.any(Function));
});

it("keeps focus inside the preview on refresh and closes a removed asset", async () => {
  await act(async () => (container.querySelector('[role="option"]') as HTMLElement).click());
  const copy = container.querySelector('[title="Copy URL"]') as HTMLElement;
  copy.focus();
  await act(async () => useInspectorStore.getState().refresh(1));
  expect(document.activeElement).toBe(copy);
  await act(async () => useInspectorStore.setState({ snapshot: { ...snapshot, assets: [] } }));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("does not present an HTTP error body as a playable manifest", async () => {
  send.mockImplementation((message, callback) => callback(message.type === "FETCH_TEXT"
    ? { ok: true, text: { ok: false, status: 403, content: "Access denied", truncated: false } }
    : { ok: true, snapshot }));
  await act(async () => useInspectorStore.setState({ snapshot: { ...snapshot, media: [{
    id: "stream", sessionId: "tab-1", manifestUrl: "https://example.com/stream.m3u8", mediaKind: "hls", createdAt: 1
  }] } }));
  expect(container.textContent).toContain("HTTP 403");
  expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Play")).toBe(false);
});
