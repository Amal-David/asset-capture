import { create } from "zustand";
import { sendMessage } from "../shared/messages";
import type { PickerResult } from "../shared/messages";
import type { AssetKind, ExportJob, SessionSnapshot } from "../shared/types";

export type SortKey = "updatedAt" | "createdAt" | "size" | "status" | "name" | "kind";
export type SortDir = "asc" | "desc";
export type StatusFilter = "all" | "ok" | "redirect" | "client-error" | "server-error" | "no-status";

interface InspectorState {
  snapshot?: SessionSnapshot;
  loading: boolean;
  error?: string;
  // Filtering: an empty kinds set means "all kinds". Multi-select lets the user
  // see e.g. image+video+audio at once instead of cycling single views.
  kinds: Set<AssetKind>;
  query: string;
  statusFilter: StatusFilter;
  onlyWithBytes: boolean;
  onlyPreviewable: boolean;
  domain?: string;
  // Sorting is client-side so the 1.5s refresh poll can't reshuffle rows under
  // the user mid-scroll (the DB only ever orders by updatedAt).
  sortKey: SortKey;
  sortDir: SortDir;
  // Multi-select for bulk download/export. Lives in the store so the bulk
  // toolbar, rows, and export wiring share one source of truth.
  selectedIds: Set<string>;
  lastExport?: ExportJob;
  pickerActive: boolean;
  pickerResult?: PickerResult;
  toggleSelect: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  toggleKind: (kind: AssetKind) => void;
  clearKinds: () => void;
  setQuery: (query: string) => void;
  setStatusFilter: (status: StatusFilter) => void;
  toggleOnlyWithBytes: () => void;
  toggleOnlyPreviewable: () => void;
  setDomain: (domain?: string) => void;
  setSortKey: (key: SortKey) => void;
  setSortDir: (dir: SortDir) => void;
  toggleSortDir: () => void;
  resetFilters: () => void;
  refresh: (tabId?: number, silent?: boolean) => Promise<void>;
  rescan: (tabId?: number) => Promise<void>;
  clear: (tabId?: number) => Promise<void>;
  exportAs: (type: ExportJob["type"], tabId?: number, selectedIds?: string[]) => Promise<void>;
  toggleDeepCapture: (tabId: number, enabled: boolean) => Promise<void>;
  downloadAsset: (url: string, filename?: string, assetId?: string) => Promise<void>;
  getAssetBody: (assetId: string) => Promise<{ mime: string; dataUrl: string; byteLength: number } | null>;
  fetchText: (url: string, tabId?: number) => Promise<{ content: string; truncated: boolean; ok: boolean; status?: number; contentType?: string } | null>;
  activatePicker: (tabId: number) => Promise<void>;
  deactivatePicker: (tabId: number) => Promise<void>;
  clearPickerResult: () => void;
}

export const useInspectorStore = create<InspectorState>((set, get) => ({
  loading: false,
  kinds: new Set<AssetKind>(),
  query: "",
  statusFilter: "all",
  onlyWithBytes: false,
  onlyPreviewable: false,
  sortKey: "updatedAt",
  sortDir: "desc",
  selectedIds: new Set<string>(),
  pickerActive: false,
  toggleSelect: (id) =>
    set((state) => {
      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      return { selectedIds };
    }),
  selectMany: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set<string>() }),
  toggleKind: (kind) =>
    set((state) => {
      const kinds = new Set(state.kinds);
      if (kinds.has(kind)) kinds.delete(kind);
      else kinds.add(kind);
      return { kinds };
    }),
  clearKinds: () => set({ kinds: new Set<AssetKind>() }),
  setQuery: (query) => set({ query }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  toggleOnlyWithBytes: () => set((state) => ({ onlyWithBytes: !state.onlyWithBytes })),
  toggleOnlyPreviewable: () => set((state) => ({ onlyPreviewable: !state.onlyPreviewable })),
  setDomain: (domain) => set({ domain }),
  setSortKey: (sortKey) => set({ sortKey }),
  setSortDir: (sortDir) => set({ sortDir }),
  toggleSortDir: () => set((state) => ({ sortDir: state.sortDir === "asc" ? "desc" : "asc" })),
  resetFilters: () => set({ kinds: new Set<AssetKind>(), query: "", statusFilter: "all", onlyWithBytes: false, onlyPreviewable: false, domain: undefined }),
  refresh: async (tabId, silent) => {
    // The 1.5s background poll runs silently so it never clears an action error
    // (failed download/export) or flickers the loading state before the user reads it.
    if (!silent) set({ loading: true, error: undefined });
    const response = await sendMessage({ type: "GET_SNAPSHOT", tabId });
    if (response.ok && "snapshot" in response) {
      const updates: Partial<InspectorState> = { snapshot: response.snapshot, loading: false };
      if (response.snapshot.pickerActive !== undefined) {
        updates.pickerActive = response.snapshot.pickerActive;
      }
      if ("pickerResult" in response && response.pickerResult) {
        updates.pickerResult = response.pickerResult;
        updates.pickerActive = false;
      }
      // Prune selection against the live snapshot so deterministic re-captured ids
      // can never silently re-attach a stale selection to assets the user didn't pick.
      const selected = get().selectedIds;
      // Skip pruning on an empty snapshot (e.g. a transient poll mid-clear) so an
      // in-progress multi-selection isn't wiped by a momentary empty result.
      if (selected.size && response.snapshot.assets.length > 0) {
        const live = new Set(response.snapshot.assets.map((asset) => asset.id));
        const pruned = new Set([...selected].filter((id) => live.has(id)));
        if (pruned.size !== selected.size) updates.selectedIds = pruned;
      }
      set(updates);
    } else if (!silent) {
      set({ error: response.ok ? "Unexpected response" : response.error, loading: false });
    } else {
      set({ loading: false });
    }
  },
  rescan: async (tabId) => {
    const response = await sendMessage({ type: "RESCAN", tabId });
    if (!response.ok) {
      set({ error: response.error });
      return;
    }
    await get().refresh(tabId);
  },
  clear: async (tabId) => {
    const response = await sendMessage({ type: "CLEAR_SESSION", tabId });
    if (!response.ok) {
      set({ error: response.error });
      return;
    }
    set({ selectedIds: new Set<string>() });
    await get().refresh(tabId);
  },
  exportAs: async (type, tabId, selectedIds) => {
    set({ loading: true, error: undefined });
    const response = await sendMessage({ type: "EXPORT", exportType: type, tabId, selectedIds });
    if (response.ok && "export" in response) {
      set({ lastExport: response.export.job, loading: false });
    } else {
      set({ error: response.ok ? "Unexpected export response" : response.error, loading: false });
    }
  },
  toggleDeepCapture: async (tabId, enabled) => {
    if (enabled) {
      const granted = await requestDebuggerPermission();
      if (!granted) {
        set({ error: "Deep capture needs the Chrome debugger permission." });
        return;
      }
    }
    const response = await sendMessage({ type: "TOGGLE_DEEP_CAPTURE", tabId, enabled });
    if (!response.ok) {
      set({ error: response.error });
      return;
    }
    await get().refresh(tabId);
  },
  downloadAsset: async (url, filename, assetId) => {
    const response = await sendMessage({ type: "DOWNLOAD_ASSET", url, filename, assetId });
    if (!response.ok) {
      set({ error: response.error });
    }
  },
  getAssetBody: async (assetId) => {
    const response = await sendMessage({ type: "GET_ASSET_BODY", assetId });
    if (response.ok && "body" in response) return response.body;
    if (!response.ok) set({ error: response.error });
    return null;
  },
  fetchText: async (url, tabId) => {
    const response = await sendMessage({ type: "FETCH_TEXT", url, tabId });
    if (response.ok && "text" in response) return response.text;
    if (!response.ok) set({ error: response.error });
    return null;
  },
  activatePicker: async (tabId) => {
    const response = await sendMessage({ type: "PICKER_ACTIVATE", tabId });
    if (response.ok) {
      set({ pickerActive: true });
    } else {
      set({ error: response.error });
    }
  },
  deactivatePicker: async (tabId) => {
    const response = await sendMessage({ type: "PICKER_DEACTIVATE", tabId });
    if (response.ok) {
      set({ pickerActive: false, pickerResult: undefined });
    } else {
      set({ error: response.error });
    }
  },
  clearPickerResult: () => set({ pickerResult: undefined })
}));

async function requestDebuggerPermission(): Promise<boolean> {
  if (!chrome.permissions?.request) return false;
  try {
    return await chrome.permissions.request({ permissions: ["debugger"] });
  } catch {
    return false;
  }
}
