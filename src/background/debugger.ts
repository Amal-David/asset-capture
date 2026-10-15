import { MAX_BODY_BYTES } from "../shared/limits";

// Tokens invalidate response bodies that finish after detach or navigation.
export const deepCaptureTabs = new Map<number, AbortController>();
const STORAGE_KEY = "deepCaptureTabIds";
let operations: Promise<unknown> = Promise.resolve();
let saves: Promise<unknown> = Promise.resolve();
let shadowCleanup: Promise<void> = Promise.resolve();
let restoring = true;
let permissionRevoked = false;
let detachListenerInstalled = false;
const invalidatedDuringRestore = new Set<number>();

function saveTabs(): Promise<void> {
  const save = saves.then(() => chrome.storage.session.set({ [STORAGE_KEY]: [...deepCaptureTabs.keys()] }));
  saves = save.catch(() => undefined);
  return save;
}

function forget(tabId: number): void {
  deepCaptureTabs.get(tabId)?.abort();
  if (deepCaptureTabs.delete(tabId)) shadowCleanup = shadowCleanup.then(() => setClosedShadowCapture(tabId, false));
}

async function enableNetwork(tabId: number): Promise<void> {
  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
    maxTotalBufferSize: 32 * 1024 * 1024,
    maxResourceBufferSize: MAX_BODY_BYTES
  });
}

async function restore(): Promise<void> {
  const stored = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
  const ids: number[] = Array.isArray(stored) ? stored.filter((id): id is number => Number.isInteger(id) && id >= 0) : [];
  const permitted = await chrome.permissions.contains({ permissions: ["debugger"] });
  if (permitted && chrome.debugger) {
    const targets = await chrome.debugger.getTargets();
    for (const tabId of ids) {
      if (permissionRevoked || invalidatedDuringRestore.has(tabId) || !targets.some((target) => target.tabId === tabId && target.attached)) {
        if (permissionRevoked || invalidatedDuringRestore.has(tabId)) {
          try { await chrome.debugger.detach({ tabId }); } catch { /* Already gone or owned by another debugger. */ }
        }
        await setClosedShadowCapture(tabId, false);
        continue;
      }
      deepCaptureTabs.set(tabId, new AbortController());
      try {
        // An attached target may belong to DevTools or another extension.
        // A command succeeds only when this extension owns the attachment.
        await enableNetwork(tabId);
      } catch {
        forget(tabId);
      }
    }
  } else {
    for (const tabId of ids) await setClosedShadowCapture(tabId, false);
  }
  await saveTabs();
}

function ensureDetachListener(): void {
  if (detachListenerInstalled || !chrome.debugger?.onDetach) return;
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === undefined) return;
    if (restoring) invalidatedDuringRestore.add(source.tabId);
    forget(source.tabId);
    void saveTabs().catch(console.warn);
  });
  detachListenerInstalled = true;
}
ensureDetachListener();
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (restoring && change.status === "loading") invalidatedDuringRestore.add(tabId);
  if (change.status !== "loading" || !deepCaptureTabs.has(tabId)) return;
  forget(tabId);
  void setDeepCapture(tabId, false).catch(console.warn);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (restoring) invalidatedDuringRestore.add(tabId);
  if (!deepCaptureTabs.has(tabId)) return;
  forget(tabId);
  void saveTabs().catch(console.warn);
});
chrome.permissions.onRemoved.addListener((permissions) => {
  if (!permissions.permissions?.includes("debugger")) return;
  if (restoring) permissionRevoked = true;
  const ids = [...deepCaptureTabs.keys()];
  for (const tabId of ids) {
    forget(tabId);
    void setDeepCapture(tabId, false).catch(console.warn);
  }
});

export const debuggerReady = restore().finally(() => { restoring = false; invalidatedDuringRestore.clear(); });

export async function getDeepCaptureState(tabId?: number): Promise<boolean> {
  await debuggerReady;
  let pending;
  do {
    pending = operations;
    await pending;
  } while (pending !== operations);
  await shadowCleanup;
  return tabId !== undefined && deepCaptureTabs.has(tabId);
}

export function setDeepCapture(tabId: number, enabled: boolean): Promise<boolean> {
  const operation = operations.then(async () => {
    await debuggerReady;
    if (!enabled) {
      try {
        await chrome.debugger?.detach({ tabId });
      } finally {
        forget(tabId);
        await shadowCleanup;
        await saveTabs();
      }
      return false;
    }
    if (deepCaptureTabs.has(tabId)) return true;
    await shadowCleanup;
    if (!await chrome.permissions.contains({ permissions: ["debugger"] })) throw new Error("Chrome debugger permission is unavailable.");
    ensureDetachListener();
    const token = new AbortController();
    deepCaptureTabs.set(tabId, token);
    let attached = false;
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      attached = true;
      if (deepCaptureTabs.get(tabId) !== token) throw new Error("Deep capture stopped while attaching.");
      await enableNetwork(tabId);
      if (deepCaptureTabs.get(tabId) !== token) throw new Error("Deep capture stopped while attaching.");
      await setClosedShadowCapture(tabId, true);
      await saveTabs();
      return deepCaptureTabs.get(tabId) === token;
    } catch (error) {
      forget(tabId);
      if (attached) {
        try { await chrome.debugger.detach({ tabId }); } catch { /* Already detached. */ }
      }
      await saveTabs();
      throw error;
    }
  });
  operations = operation.catch(() => undefined);
  return operation;
}

async function setClosedShadowCapture(tabId: number, enabled: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: enabled ? enableClosedShadowCapture : disableClosedShadowCapture
    });
  } catch {
    // Optional hardening path: debugger capture still works when a frame refuses injection.
  }
}

function enableClosedShadowCapture(): void {
  const key = "__assetInspectorClosedShadowCapture";
  const target = window as typeof window & {
    [key]?: {
      original: typeof Element.prototype.attachShadow;
      patched: typeof Element.prototype.attachShadow;
      enabled: boolean;
    };
  };
  const existing = target[key];
  if (existing?.enabled) return;
  const original = existing?.original ?? Element.prototype.attachShadow;
  const patched = function patchedAttachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
    return original.call(this, { ...init, mode: "open" });
  } as typeof Element.prototype.attachShadow;
  target[key] = { original, patched, enabled: true };
  Element.prototype.attachShadow = patched;
}

function disableClosedShadowCapture(): void {
  const key = "__assetInspectorClosedShadowCapture";
  const target = window as typeof window & {
    [key]?: {
      original: typeof Element.prototype.attachShadow;
      patched: typeof Element.prototype.attachShadow;
      enabled: boolean;
    };
  };
  const state = target[key];
  if (!state?.enabled) return;
  if (Element.prototype.attachShadow === state.patched) Element.prototype.attachShadow = state.original;
  state.enabled = false;
}
