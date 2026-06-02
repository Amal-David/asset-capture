import { create } from "zustand";
import { sendMessage } from "../shared/messages";
import type { PickerResult } from "../shared/messages";
import type { AssetKind, ExportJob, SessionSnapshot } from "../shared/types";

interface InspectorState {
  snapshot?: SessionSnapshot;
  loading: boolean;
  error?: string;
  filter: AssetKind | "all";
  query: string;
  lastExport?: ExportJob;
  pickerActive: boolean;
  pickerResult?: PickerResult;
  setFilter: (filter: AssetKind | "all") => void;
  setQuery: (query: string) => void;
  refresh: (tabId?: number) => Promise<void>;
  clear: (tabId?: number) => Promise<void>;
  exportAs: (type: ExportJob["type"], tabId?: number) => Promise<void>;
  toggleDeepCapture: (tabId: number, enabled: boolean) => Promise<void>;
  downloadAsset: (url: string, filename?: string, assetId?: string) => Promise<void>;
  getAssetBody: (assetId: string) => Promise<{ mime: string; dataUrl: string } | null>;
  activatePicker: (tabId: number) => Promise<void>;
  deactivatePicker: (tabId: number) => Promise<void>;
  clearPickerResult: () => void;
}

export const useInspectorStore = create<InspectorState>((set, get) => ({
  loading: false,
  filter: "all",
  query: "",
  pickerActive: false,
  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
  refresh: async (tabId) => {
    set({ loading: true, error: undefined });
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
      set(updates);
    } else {
      set({ error: response.ok ? "Unexpected response" : response.error, loading: false });
    }
  },
  clear: async (tabId) => {
    const response = await sendMessage({ type: "CLEAR_SESSION", tabId });
    if (!response.ok) {
      set({ error: response.error });
      return;
    }
    await get().refresh(tabId);
  },
  exportAs: async (type, tabId) => {
    set({ loading: true, error: undefined });
    const response = await sendMessage({ type: "EXPORT", exportType: type, tabId });
    if (response.ok && "export" in response) {
      set({ lastExport: response.export.job, loading: false });
    } else {
      set({ error: response.ok ? "Unexpected export response" : response.error, loading: false });
    }
  },
  toggleDeepCapture: async (tabId, enabled) => {
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
