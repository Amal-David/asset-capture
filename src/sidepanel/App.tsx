import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Box, Check, ChevronDown, Clipboard, Copy, Crosshair, Database, Download, ExternalLink, Eye, FileArchive, FileJson, FileSpreadsheet, FileText, Film, Inbox, List, Loader2, Lock, Network, RefreshCw, ScanSearch, Search, Shield, Trash2, X, Zap } from "lucide-react";
import { useInspectorStore } from "./store";
import type { SortDir, SortKey, StatusFilter } from "./store";
import type { AssetKind, AssetRecord, ExportJob, MediaRecord } from "../shared/types";
import { isBrowserDecodableImage, isModelViewerCompatible, isPreviewableKind } from "../shared/classify";
import { parseManifest } from "../shared/manifest";
import type { ParsedManifest } from "../shared/manifest";
import { base64ToBytes, safeFilename } from "../shared/url";
import "../styles/global.css";

// Static class strings (not interpolated) so Tailwind keeps them at build time.
const KIND_BADGE: Record<AssetKind, string> = {
  image: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  video: "bg-violet-50 text-violet-700 ring-violet-600/20",
  audio: "bg-pink-50 text-pink-700 ring-pink-600/20",
  font: "bg-amber-50 text-amber-700 ring-amber-600/20",
  json: "bg-sky-50 text-sky-700 ring-sky-600/20",
  api: "bg-teal-50 text-teal-700 ring-teal-600/20",
  css: "bg-blue-50 text-blue-700 ring-blue-600/20",
  script: "bg-yellow-50 text-yellow-800 ring-yellow-600/20",
  wasm: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  archive: "bg-orange-50 text-orange-700 ring-orange-600/20",
  model: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20",
  subtitle: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
  manifest: "bg-rose-50 text-rose-700 ring-rose-600/20",
  binary: "bg-slate-100 text-slate-600 ring-slate-500/20",
  unknown: "bg-slate-100 text-slate-500 ring-slate-400/20"
};

const EXPORTS: Array<{ type: ExportJob["type"]; label: string; icon: React.ReactNode }> = [
  { type: "json", label: "JSON metadata", icon: <FileJson size={15} /> },
  { type: "csv", label: "CSV", icon: <FileSpreadsheet size={15} /> },
  { type: "url-list", label: "URL list", icon: <List size={15} /> },
  { type: "har", label: "HAR", icon: <Network size={15} /> },
  { type: "zip", label: "ZIP (with bytes)", icon: <FileArchive size={15} /> }
];

interface AppProps {
  compact?: boolean;
  tabId?: number;
}

export function App({ compact = false, tabId }: AppProps) {
  const [activeTabId, setActiveTabId] = useState<number | undefined>(tabId);
  const [selectedAsset, setSelectedAsset] = useState<AssetRecord | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; asset: AssetRecord } | null>(null);
  const openMenu = useCallback((event: React.MouseEvent, asset: AssetRecord) => {
    event.preventDefault();
    setSelectedAsset(asset);
    setMenu({ x: event.clientX, y: event.clientY, asset });
  }, []);
  const {
    snapshot, loading, error, kinds, query, statusFilter, onlyWithBytes, onlyPreviewable, domain, sortKey, sortDir, selectedIds,
    lastExport, pickerActive, pickerResult,
    toggleKind, clearKinds, setQuery, setStatusFilter, toggleOnlyWithBytes, toggleOnlyPreviewable, setDomain, setSortKey, toggleSortDir, resetFilters,
    toggleSelect, selectMany, clearSelection,
    refresh, rescan, clear, exportAs, toggleDeepCapture, downloadAsset, activatePicker, deactivatePicker, clearPickerResult
  } = useInspectorStore();

  useEffect(() => {
    if (tabId) {
      setActiveTabId(tabId);
      void refresh(tabId);
      return;
    }
    chrome.tabs?.query?.({ active: true, currentWindow: true }, ([tab]) => {
      setActiveTabId(tab?.id);
      void refresh(tab?.id);
    });
  }, [refresh, tabId]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(activeTabId), 1500);
    return () => window.clearInterval(timer);
  }, [activeTabId, refresh]);

  const [flashAssetId, setFlashAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerResult) return;
    const allAssets = snapshot?.assets ?? [];
    const pickedUrl = pickerResult.assetUrl;
    let match = allAssets.find((a) => a.url === pickedUrl);
    if (!match) {
      try {
        const pathname = new URL(pickedUrl).pathname;
        match = allAssets.find((a) => a.url.includes(pathname));
      } catch { /* ignore */ }
    }
    if (match) {
      resetFilters();
      setSelectedAsset(match);
      setFlashAssetId(match.id);
      setTimeout(() => setFlashAssetId(null), 1200);
    }
    clearPickerResult();
  }, [pickerResult, snapshot?.assets, clearPickerResult, resetFilters]);

  const assets = snapshot?.assets ?? [];
  const counts = useMemo(() => countByKind(assets), [assets]);
  const blobCount = snapshot?.blobs.length ?? 0;
  const media = snapshot?.media ?? [];
  const mediaCount = media.length;
  const bytesCount = useMemo(() => assets.reduce((n, a) => n + (a.bodyAvailable ? 1 : 0), 0), [assets]);
  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      const host = hostOf(a.url);
      if (host) set.add(host);
    }
    return Array.from(set).sort();
  }, [assets]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (kinds.size && !kinds.has(asset.kind)) return false;
      if (onlyWithBytes && !asset.bodyAvailable) return false;
      if (onlyPreviewable && !isPreviewableKind(asset.kind)) return false;
      if (statusFilter !== "all" && statusClass(asset.status) !== statusFilter) return false;
      if (domain && hostOf(asset.url) !== domain) return false;
      if (normalizedQuery) {
        const haystack = `${asset.url} ${asset.mime ?? ""} ${asset.sources.join(" ")}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [assets, kinds, query, statusFilter, onlyWithBytes, onlyPreviewable, domain]);

  // Sort client-side so the periodic refresh (which only bumps updatedAt) can't
  // reshuffle rows under the user. Missing size/status always sort last.
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => compareAssets(a, b, sortKey, dir));
  }, [filtered, sortKey, sortDir]);

  // Keep the selected asset's data fresh as the snapshot refreshes (e.g. bytes
  // arrive after metadata) without losing the open drawer.
  const liveSelected = useMemo(
    () => (selectedAsset ? assets.find((a) => a.id === selectedAsset.id) ?? selectedAsset : null),
    [assets, selectedAsset]
  );

  return (
    <main className={compact ? "flex h-[600px] w-[380px] flex-col bg-panel text-ink" : "flex min-h-screen flex-col bg-panel text-ink"}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <Eye size={17} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight">Asset Inspector</h1>
              <p className="truncate text-xs text-slate-500">
                {assets.length} asset{assets.length === 1 ? "" : "s"}
                {bytesCount > 0 && <span> · {bytesCount} with bytes</span>}
                {blobCount > 0 && <span> · {blobCount} blob{blobCount === 1 ? "" : "s"}</span>}
                {!compact && mediaCount > 0 && <span> · {mediaCount} stream{mediaCount === 1 ? "" : "s"}</span>}
                {snapshot?.deepCaptureAttached && <span className="text-accent"> · deep</span>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!compact && (
              <IconButton
                active={pickerActive}
                title={pickerActive ? "Cancel element picker" : "Pick an asset from the page"}
                disabled={!activeTabId}
                onClick={() => {
                  if (!activeTabId) return;
                  if (pickerActive) void deactivatePicker(activeTabId);
                  else void activatePicker(activeTabId);
                }}
              >
                <Crosshair size={16} />
              </IconButton>
            )}
            <ExportMenu onExport={exportAs} tabId={activeTabId} disabled={!assets.length} />
            {!compact && (
              <IconButton title="Rescan page (re-walk DOM, shadow roots & stylesheets)" onClick={() => void rescan(activeTabId)} disabled={!activeTabId}>
                <ScanSearch size={16} />
              </IconButton>
            )}
            <IconButton title="Refresh" onClick={() => void refresh(activeTabId)}>
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </IconButton>
            {!compact && (
              <IconButton title="Clear session" onClick={() => void clear(activeTabId)} disabled={!assets.length}>
                <Trash2 size={16} />
              </IconButton>
            )}
          </div>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-slate-400"
            placeholder="Filter by URL or MIME type"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600" title="Clear filter" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
          <Chip label="All" count={assets.length} active={kinds.size === 0} onClick={clearKinds} />
          {(Object.keys(counts) as AssetKind[])
            .sort((a, b) => counts[b] - counts[a])
            .map((kind) => (
              <Chip key={kind} label={kind} count={counts[kind]} active={kinds.has(kind)} onClick={() => toggleKind(kind)} />
            ))}
        </div>

        <FilterControls
          compact={compact}
          sortKey={sortKey}
          sortDir={sortDir}
          setSortKey={setSortKey}
          toggleSortDir={toggleSortDir}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          onlyWithBytes={onlyWithBytes}
          toggleOnlyWithBytes={toggleOnlyWithBytes}
          onlyPreviewable={onlyPreviewable}
          toggleOnlyPreviewable={toggleOnlyPreviewable}
          domain={domain}
          domains={domains}
          setDomain={setDomain}
          showing={sorted.length}
          total={assets.length}
          onReset={resetFilters}
        />
      </div>

      {!compact && (
        <DeepCaptureBar
          attached={snapshot?.deepCaptureAttached ?? false}
          disabled={!activeTabId}
          onToggle={() => activeTabId && void toggleDeepCapture(activeTabId, !snapshot?.deepCaptureAttached)}
        />
      )}

      {!compact && mediaCount > 0 && <StreamsPanel media={media} tabId={activeTabId} />}

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {lastExport && <ExportNotice job={lastExport} />}

      {sorted.some((a) => selectedIds.has(a.id)) && (
        <BulkBar
          count={sorted.filter((a) => selectedIds.has(a.id)).length}
          onSelectAll={() => selectMany(sorted.map((a) => a.id))}
          onClear={clearSelection}
          onCopyUrls={() => {
            const urls = sorted.filter((a) => selectedIds.has(a.id)).map((a) => a.url).join("\n");
            void navigator.clipboard.writeText(urls);
          }}
          onDownload={() => {
            for (const asset of sorted.filter((a) => selectedIds.has(a.id))) {
              void downloadAsset(asset.url, safeFilename(asset.url, asset.id), asset.id);
            }
          }}
          onExportZip={() => void exportAs("zip", activeTabId, [...selectedIds])}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <AssetList
          assets={sorted}
          compact={compact}
          loading={loading}
          hasAssets={assets.length > 0}
          onSelect={setSelectedAsset}
          onContextMenu={openMenu}
          selectedId={liveSelected?.id}
          flashId={flashAssetId}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      </div>

      {liveSelected && (
        <PreviewDrawer asset={liveSelected} compact={compact} onClose={() => setSelectedAsset(null)} onContextMenu={openMenu} />
      )}

      {menu && <AssetContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </main>
  );
}

function IconButton({ children, title, onClick, disabled, active }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-accent-soft text-accent" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
        active ? "border-accent bg-accent text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
    </button>
  );
}

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "updatedAt", label: "Last seen" },
  { key: "createdAt", label: "First seen" },
  { key: "size", label: "Size" },
  { key: "status", label: "Status" },
  { key: "name", label: "Name" },
  { key: "kind", label: "Type" }
];

const STATUS_OPTIONS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "Any status" },
  { key: "ok", label: "2xx OK" },
  { key: "redirect", label: "3xx" },
  { key: "client-error", label: "4xx" },
  { key: "server-error", label: "5xx" },
  { key: "no-status", label: "No status" }
];

function FilterControls({
  compact, sortKey, sortDir, setSortKey, toggleSortDir, statusFilter, setStatusFilter,
  onlyWithBytes, toggleOnlyWithBytes, onlyPreviewable, toggleOnlyPreviewable, domain, domains, setDomain, showing, total, onReset
}: {
  compact: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  setSortKey: (key: SortKey) => void;
  toggleSortDir: () => void;
  statusFilter: StatusFilter;
  setStatusFilter: (status: StatusFilter) => void;
  onlyWithBytes: boolean;
  toggleOnlyWithBytes: () => void;
  onlyPreviewable: boolean;
  toggleOnlyPreviewable: () => void;
  domain?: string;
  domains: string[];
  setDomain: (domain?: string) => void;
  showing: number;
  total: number;
  onReset: () => void;
}) {
  const selectClass = "rounded-md border border-slate-200 bg-white py-1 pl-2 pr-6 text-xs text-slate-600 outline-none focus:border-accent";
  const filtersActive = showing !== total || statusFilter !== "all" || onlyWithBytes || onlyPreviewable || Boolean(domain);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <div className="flex items-center gap-1">
        <select className={selectClass} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} title="Sort by">
          {SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>Sort: {option.label}</option>
          ))}
        </select>
        <button
          className="rounded-md border border-slate-200 bg-white p-1 text-slate-500 hover:bg-slate-50"
          title={sortDir === "asc" ? "Ascending" : "Descending"}
          onClick={toggleSortDir}
        >
          {sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </button>
      </div>

      <select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} title="Filter by status">
        {STATUS_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </select>

      <ToggleChip active={onlyWithBytes} onClick={toggleOnlyWithBytes} icon={<Database size={12} />} label="Bytes" title="Only assets with captured bytes" />
      <ToggleChip active={onlyPreviewable} onClick={toggleOnlyPreviewable} icon={<Eye size={12} />} label="Previewable" title="Only previewable kinds" />

      {!compact && domains.length > 1 && (
        <select className={`${selectClass} max-w-[160px]`} value={domain ?? ""} onChange={(e) => setDomain(e.target.value || undefined)} title="Filter by domain">
          <option value="">All domains</option>
          {domains.map((host) => (
            <option key={host} value={host}>{host}</option>
          ))}
        </select>
      )}

      <span className="ml-auto flex items-center gap-2 text-slate-400">
        <span className="tabular-nums">{showing === total ? `${total}` : `${showing} / ${total}`}</span>
        {filtersActive && (
          <button className="rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700" onClick={onReset} title="Reset filters">
            Reset
          </button>
        )}
      </span>
    </div>
  );
}

function ToggleChip({ active, onClick, icon, label, title }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors ${
        active ? "border-accent bg-accent-soft text-accent" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ExportMenu({ onExport, tabId, disabled }: { onExport: (type: ExportJob["type"], tabId?: number) => Promise<void>; tabId?: number; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "bg-accent-soft text-accent" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        }`}
        title="Export captured assets"
      >
        <Download size={16} />
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-52 animate-fade-in overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-menu">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Export as</div>
          {EXPORTS.map((item) => (
            <button
              key={item.type}
              onClick={() => {
                setOpen(false);
                void onExport(item.type, tabId);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <span className="text-slate-400">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeepCaptureBar({ attached, disabled, onToggle }: { attached: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-surface px-3 py-2 shadow-card">
      <div className="flex items-center gap-2">
        <Zap size={15} className={attached ? "text-accent" : "text-slate-400"} />
        <div>
          <div className="text-sm font-medium leading-tight">Deep capture</div>
          <div className="text-xs text-slate-500">Attach the debugger Network domain.</div>
        </div>
      </div>
      <button
        disabled={disabled}
        onClick={onToggle}
        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          attached ? "bg-signal text-white hover:bg-rose-700" : "bg-accent text-white hover:bg-teal-700"
        }`}
      >
        {attached ? "Detach" : "Attach"}
      </button>
    </div>
  );
}

function ExportNotice({ job }: { job: ExportJob }) {
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-teal-200 bg-accent-soft px-3 py-2 text-sm text-teal-900">
      <Shield size={15} className="shrink-0" />
      <span>
        Exported {job.type.toUpperCase()} · {job.fileCount} asset{job.fileCount === 1 ? "" : "s"} · {job.redactionSummary.length} redaction{job.redactionSummary.length === 1 ? "" : "s"}
        {job.failures.length > 0 && <span className="font-medium text-rose-700"> · {job.failures.length} failed</span>}
      </span>
    </div>
  );
}

function StreamsPanel({ media, tabId }: { media: MediaRecord[]; tabId?: number }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mx-4 mt-3 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-card">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((value) => !value)}>
        <Film size={15} className="text-accent" />
        <span className="text-sm font-medium">Streams</span>
        <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">{media.length}</span>
        <ChevronDown size={14} className={`ml-auto text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="divide-y divide-slate-100 border-t border-slate-200">
          {media.map((record) => <ManifestCard key={record.id} record={record} tabId={tabId} />)}
        </div>
      )}
    </section>
  );
}

function ManifestCard({ record, tabId }: { record: MediaRecord; tabId?: number }) {
  const { fetchText } = useInspectorStore();
  const [parsed, setParsed] = useState<ParsedManifest | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const kind = record.mediaKind === "dash" ? "dash" : "hls";

  useEffect(() => {
    if (record.mediaKind !== "hls" && record.mediaKind !== "dash") { setState("error"); return; }
    let cancelled = false;
    setState("loading");
    void fetchText(record.manifestUrl, tabId).then((res) => {
      if (cancelled) return;
      if (!res || !res.content) { setState("error"); return; }
      try { setParsed(parseManifest(kind, res.content)); setState("ready"); } catch { setState("error"); }
    });
    return () => { cancelled = true; };
  }, [record.manifestUrl, record.mediaKind, kind, fetchText, tabId]);

  const { primary } = describeUrl(record.manifestUrl);
  return (
    <div className="px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 ring-1 ring-inset ring-rose-600/20">{record.mediaKind}</span>
        <a
          href={record.manifestUrl}
          onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: record.manifestUrl }); }}
          className="min-w-0 flex-1 truncate font-mono text-xs text-accent hover:underline"
          title={record.manifestUrl}
        >
          {primary}
        </a>
        {parsed?.drmDetected && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"><Lock size={10} /> DRM</span>
        )}
      </div>
      {state === "loading" && <div className="mt-1 text-xs text-slate-400">Parsing manifest…</div>}
      {state === "error" && <div className="mt-1 text-xs text-slate-400">Couldn't read manifest (cross-origin or offline).</div>}
      {state === "ready" && parsed && (
        <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
          {parsed.resolutions.length > 0 && <div><span className="text-slate-400">Resolutions:</span> {parsed.resolutions.join(", ")}</div>}
          {parsed.codecs.length > 0 && <div className="truncate"><span className="text-slate-400">Codecs:</span> {parsed.codecs.join(", ")}</div>}
          {parsed.variants.length > 0 && <div><span className="text-slate-400">Variants:</span> {parsed.variants.length}</div>}
          {parsed.segmentCount != null && <div><span className="text-slate-400">Segments:</span> {parsed.segmentCount}</div>}
          {parsed.variants.length === 0 && parsed.resolutions.length === 0 && parsed.segmentCount == null && (
            <div className="text-slate-400">Media playlist (no variant info).</div>
          )}
        </div>
      )}
    </div>
  );
}

const POPUP_CAP = 50;
const WINDOW_STEP = 200;

function BulkBar({ count, onSelectAll, onClear, onCopyUrls, onDownload, onExportZip }: { count: number; onSelectAll: () => void; onClear: () => void; onCopyUrls: () => void; onDownload: () => void; onExportZip: () => void }) {
  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
      <span className="font-medium text-teal-900">{count} selected</span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <BulkButton icon={<Download size={14} />} label="Download" onClick={onDownload} />
        <BulkButton icon={<Copy size={14} />} label="Copy URLs" onClick={onCopyUrls} />
        <BulkButton icon={<FileArchive size={14} />} label="Export ZIP" onClick={onExportZip} />
        <button className="rounded-md px-2 py-1 text-xs text-teal-800 hover:bg-white/60" onClick={onSelectAll}>Select all</button>
        <button className="rounded-md px-2 py-1 text-xs text-teal-800 hover:bg-white/60" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}

function BulkButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-teal-800 shadow-sm hover:bg-white/80" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function AssetList({ assets, compact, loading, hasAssets, onSelect, onContextMenu, selectedId, flashId, selectedIds, onToggleSelect }: { assets: AssetRecord[]; compact: boolean; loading: boolean; hasAssets: boolean; onSelect: (asset: AssetRecord) => void; onContextMenu: (event: React.MouseEvent, asset: AssetRecord) => void; selectedId?: string; flashId?: string | null; selectedIds: Set<string>; onToggleSelect: (id: string) => void }) {
  const [visible, setVisible] = useState(WINDOW_STEP);
  const [focusIndex, setFocusIndex] = useState(0);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = compact ? assets.slice(0, POPUP_CAP) : assets.slice(0, visible);
  const hasMore = !compact && assets.length > visible;
  const truncatedPopup = compact && assets.length > POPUP_CAP;

  // Grow the window as the sentinel scrolls into view — keeps thousands of
  // assets responsive without rendering them all or pulling in a virtualizer dep.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible((value) => value + WINDOW_STEP);
    }, { rootMargin: "400px" });
    io.observe(node);
    return () => io.disconnect();
    // `visible` is a dep so the observer re-attaches after each growth step — an IO
    // only fires on transitions, so without this a sentinel that stays inside the
    // rootMargin would never trigger a second load.
  }, [hasMore, assets.length, visible]);

  const flashRef = useCallback((node: HTMLLIElement | null) => {
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!shown.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((index) => {
        const next = Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        const row = listRef.current?.querySelector(`[data-row="${next}"]`);
        row?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const asset = shown[Math.min(focusIndex, shown.length - 1)];
      if (asset) onSelect(asset);
    } else if (event.key === " ") {
      event.preventDefault();
      const asset = shown[Math.min(focusIndex, shown.length - 1)];
      if (asset) onToggleSelect(asset.id);
    }
  };

  if (!assets.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <Inbox size={28} className="text-slate-300" />
        <p className="text-sm font-medium text-slate-600">
          {loading && !hasAssets ? "Collecting assets…" : hasAssets ? "No assets match this filter" : "No assets captured yet"}
        </p>
        <p className="max-w-[260px] text-xs text-slate-400">
          {hasAssets ? "Try a different type or clear the search." : "Open a page and reload it — images, media, fonts and API responses appear here automatically."}
        </p>
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Captured assets"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="divide-y divide-slate-100 outline-none"
    >
      {shown.map((asset, index) => {
        const isSelected = selectedId === asset.id;
        const isChecked = selectedIds.has(asset.id);
        const isFocused = index === focusIndex;
        const isFlashing = flashId === asset.id;
        const { primary, secondary } = describeUrl(asset.url);
        return (
          <li
            key={asset.id}
            ref={isFlashing ? flashRef : undefined}
            data-row={index}
            role="option"
            aria-selected={isSelected}
            onClick={() => { setFocusIndex(index); onSelect(asset); }}
            onContextMenu={(event) => onContextMenu(event, asset)}
            className={`group flex cursor-pointer items-center gap-2.5 px-4 py-2.5 transition-colors ${
              isSelected ? "bg-accent-soft" : isChecked ? "bg-accent-soft/40" : "hover:bg-slate-50"
            } ${isFocused ? "ring-1 ring-inset ring-accent/40" : ""} ${isFlashing ? "picker-flash" : ""}`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggleSelect(asset.id)}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
              aria-label={`Select ${primary}`}
            />
            <KindBadge kind={asset.kind} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-800" title={asset.url}>{primary}</span>
                {asset.bodyAvailable && <span title="Bytes captured — downloads offline" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
              </div>
              {secondary && <div className="truncate text-xs text-slate-400" title={asset.url}>{secondary}</div>}
            </div>
            {asset.status != null && <StatusPill status={asset.status} />}
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
              <RowAction title="Open in new tab" onClick={() => chrome.tabs.create({ url: asset.url })}>
                <ExternalLink size={14} />
              </RowAction>
            </div>
          </li>
        );
      })}
      {hasMore && <li ref={sentinelRef} className="px-4 py-3 text-center text-xs text-slate-400">Loading more… ({visible} of {assets.length})</li>}
      {truncatedPopup && <li className="px-4 py-3 text-center text-xs text-slate-400">Showing {POPUP_CAP} of {assets.length} — open the full side panel to see all.</li>}
    </ul>
  );
}

function RowAction({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <span
      role="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
    >
      {children}
    </span>
  );
}

function KindBadge({ kind }: { kind: AssetKind }) {
  return (
    <span className={`inline-flex w-14 shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${KIND_BADGE[kind]}`}>
      {kind}
    </span>
  );
}

function StatusPill({ status }: { status: number }) {
  const tone =
    status >= 200 && status < 300 ? "text-emerald-600" : status >= 300 && status < 400 ? "text-amber-600" : "text-rose-600";
  return <span className={`shrink-0 text-xs font-medium tabular-nums ${tone}`}>{status}</span>;
}

function AssetContextMenu({ menu, onClose }: { menu: { x: number; y: number; asset: AssetRecord }; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { downloadAsset, getAssetBody } = useInspectorStore();
  const asset = menu.asset;

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const run = (action: () => void | Promise<void>) => () => {
    void Promise.resolve(action()).finally(onClose);
  };

  // Keep the menu on-screen near the right/bottom edges.
  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 180);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] min-w-[200px] animate-fade-in overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-menu"
      style={{ top, left }}
    >
      <ContextItem icon={<Download size={15} />} label="Download" onClick={run(() => downloadAsset(asset.url, safeFilename(asset.url, asset.id), asset.id))} />
      <ContextItem icon={<Copy size={15} />} label="Copy URL" onClick={run(() => navigator.clipboard.writeText(asset.url))} />
      <ContextItem icon={<ExternalLink size={15} />} label="Open in new tab" onClick={run(() => { chrome.tabs.create({ url: asset.url }); })} />
      <ContextItem
        icon={<Clipboard size={15} />}
        label="Copy as data URL"
        disabled={!asset.bodyAvailable}
        onClick={run(async () => {
          const body = await getAssetBody(asset.id);
          if (body) await navigator.clipboard.writeText(body.dataUrl);
        })}
      />
    </div>
  );
}

function ContextItem({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <span className="text-slate-400">{icon}</span>
      {label}
    </button>
  );
}

function PreviewDrawer({ asset, compact, onClose, onContextMenu }: { asset: AssetRecord; compact: boolean; onClose: () => void; onContextMenu: (event: React.MouseEvent, asset: AssetRecord) => void }) {
  const { downloadAsset } = useInspectorStore();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyUrl = () => {
    void navigator.clipboard.writeText(asset.url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-40 animate-fade-in bg-slate-900/30" onClick={onClose} />
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full animate-drawer-in flex-col bg-surface shadow-drawer ${compact ? "w-full" : "w-full max-w-[440px]"}`}
        onContextMenu={(event) => onContextMenu(event, asset)}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <KindBadge kind={asset.kind} />
            <h2 className="truncate text-sm font-semibold text-slate-800" title={asset.url}>{describeUrl(asset.url).primary}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton title="Download" onClick={() => void downloadAsset(asset.url, safeFilename(asset.url, asset.id), asset.id)}>
              <Download size={16} />
            </IconButton>
            <IconButton title={copied ? "Copied!" : "Copy URL"} onClick={copyUrl}>
              {copied ? <Check size={16} className="text-accent" /> : <Copy size={16} />}
            </IconButton>
            <IconButton title="Open in new tab" onClick={() => chrome.tabs.create({ url: asset.url })}>
              <ExternalLink size={16} />
            </IconButton>
            <IconButton title="Close" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="preview-canvas flex min-h-[200px] items-center justify-center border-b border-slate-200 p-4">
            <PreviewBody asset={asset} />
          </div>

          <dl className="space-y-2 px-4 py-3 text-sm">
            <MetaRow label="URL" value={asset.url} mono clickable />
            <MetaRow label="Type" value={asset.kind} />
            {asset.mime && <MetaRow label="MIME" value={asset.mime} />}
            {asset.status != null && <MetaRow label="Status" value={String(asset.status)} />}
            {asset.size != null && <MetaRow label="Size" value={formatBytes(asset.size)} />}
            {asset.timing?.durationMs != null && <MetaRow label="Duration" value={`${asset.timing.durationMs}ms`} />}
            <MetaRow label="Sources" value={asset.sources.join(", ")} />
            <MetaRow label="Bytes" value={asset.bodyAvailable ? "Captured (offline-ready)" : "Not captured"} />
            {asset.redactionFlags.length > 0 && <MetaRow label="Redacted" value={asset.redactionFlags.join(", ")} />}
          </dl>
        </div>
      </aside>
    </>
  );
}

const TEXT_KINDS: AssetKind[] = ["json", "api", "manifest", "subtitle", "css"];
// Matches the capture ceiling (page-hooks/service-worker MAX_BODY_BYTES) so the
// "too large to preview" guard reflects the real limit rather than implying
// support for sizes that are never stored.
const LARGE_PREVIEW_BYTES = 16 * 1024 * 1024;

// Orchestrates "render-or-hide": acquire a source (captured bytes preferred as an
// object URL), then probe whether it actually decodes before showing it. Anything
// that can't render falls back to a download/open card instead of a dead element.
function PreviewBody({ asset }: { asset: AssetRecord }) {
  const { getAssetBody, fetchText } = useInspectorStore();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [byteState, setByteState] = useState<"idle" | "loading" | "ready" | "toobig">("idle");
  const isText = TEXT_KINDS.includes(asset.kind);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    setObjectUrl(null);
    if (!asset.bodyAvailable) { setByteState("idle"); return; }
    setByteState("loading");
    void getAssetBody(asset.id).then((body) => {
      if (cancelled) return;
      if (!body) { setByteState("idle"); return; }
      if (body.byteLength > LARGE_PREVIEW_BYTES) { setByteState("toobig"); return; }
      const url = dataUrlToObjectUrl(body.dataUrl);
      revoke = url;
      setObjectUrl(url);
      setByteState("ready");
    });
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [asset.id, asset.bodyAvailable, getAssetBody]);

  if (isText) {
    return <TextPreviewLoader asset={asset} objectUrl={objectUrl} waiting={Boolean(asset.bodyAvailable) && byteState === "loading"} fetchText={fetchText} />;
  }

  if (asset.url.startsWith("blob:") && !asset.bodyAvailable) {
    return <FailCard asset={asset} title="Bytes not captured" desc="This blob URL is scoped to the page. Reload it with the inspector open to capture the bytes." canDownload={false} />;
  }
  if (byteState === "toobig") return <FailCard asset={asset} title="Large asset" desc="Too large to preview inline — download to view it." />;
  if (asset.bodyAvailable && byteState === "loading") return <Spinner label="Loading bytes…" />;

  const src = objectUrl ?? (asset.url.startsWith("blob:") ? null : asset.url);
  if (!src) return <Spinner label="Loading…" />;

  if (asset.kind === "image") {
    if (!isBrowserDecodableImage(asset.url, asset.mime)) {
      return <FailCard asset={asset} title={`${(asset.extension ?? "image").toUpperCase()} not displayable`} desc="Your browser can't render this image format. Download or open it instead." />;
    }
    return <ProbedPreview kind="image" src={src} asset={asset} />;
  }
  if (asset.kind === "video" || asset.kind === "audio") return <ProbedPreview kind={asset.kind} src={src} asset={asset} />;
  if (asset.kind === "font") return <FontPreview url={src} asset={asset} />;
  if (asset.kind === "model") return <ModelPreview asset={asset} src={src} />;

  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-400">
      <FileText size={26} />
      <span className="text-xs">No inline preview for {asset.kind} assets</span>
    </div>
  );
}

// Render the real element only once a probe confirms it decodes; on failure (incl.
// a stall timeout for slow sites) show a download card instead of a broken player.
function usePreviewProbe(kind: "image" | "video" | "audio", src: string): "loading" | "ready" | "failed" {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const settle = (ok: boolean) => { if (!cancelled) setState(ok ? "ready" : "failed"); };
    if (kind === "image") {
      const img = new Image();
      const timer = window.setTimeout(() => settle(false), 12000); // stalled CDN image
      img.onload = () => { window.clearTimeout(timer); settle(true); };
      img.onerror = () => { window.clearTimeout(timer); settle(false); };
      img.src = src;
      return () => { cancelled = true; window.clearTimeout(timer); img.onload = null; img.onerror = null; };
    }
    const el = document.createElement(kind);
    el.preload = "metadata";
    const ok = () => settle(true);
    const bad = () => settle(false);
    el.addEventListener("loadeddata", ok, { once: true });
    el.addEventListener("canplay", ok, { once: true });
    el.addEventListener("error", bad, { once: true });
    el.src = src;
    const timer = window.setTimeout(() => settle(false), 12000);
    return () => { cancelled = true; window.clearTimeout(timer); el.removeAttribute("src"); el.load(); };
  }, [kind, src]);
  return state;
}

function ProbedPreview({ kind, src, asset }: { kind: "image" | "video" | "audio"; src: string; asset: AssetRecord }) {
  const state = usePreviewProbe(kind, src);
  if (state === "loading") return <Spinner label="Rendering…" />;
  if (state === "failed") return <FailCard asset={asset} title="Couldn't render preview" desc="The asset didn't decode in the browser. Download to inspect it." />;
  if (kind === "image") return <img src={src} alt="Asset preview" className="max-h-[320px] max-w-full rounded object-contain" />;
  if (kind === "video") return <video src={src} controls className="max-h-[320px] max-w-full rounded" preload="metadata" />;
  return <audio src={src} controls preload="metadata" className="w-full" />;
}

function TextPreviewLoader({ asset, objectUrl, waiting, fetchText }: { asset: AssetRecord; objectUrl: string | null; waiting: boolean; fetchText: (url: string, tabId?: number) => Promise<{ content: string; truncated: boolean; ok: boolean; status?: number } | null> }) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error" | "empty">("loading");
  const [errorDesc, setErrorDesc] = useState("The text response couldn't be read (blocked, errored, or offline).");

  useEffect(() => {
    if (waiting) return;
    let cancelled = false;
    setState("loading"); setContent(null); setTruncated(false);
    const pretty = (raw: string) => {
      if (asset.kind === "json" || asset.kind === "api") {
        try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
      }
      return raw;
    };
    const run = async () => {
      try {
        if (objectUrl) {
          const raw = await fetch(objectUrl).then((r) => r.text());
          if (cancelled) return;
          if (!raw) { setState("empty"); return; }
          setContent(pretty(raw)); setState("ready");
          return;
        }
        // Route through the service worker so cross-origin manifests/subtitles/APIs
        // aren't blocked by the sidepanel origin's CORS.
        const res = await fetchText(asset.url);
        if (cancelled) return;
        if (!res) { setState("error"); return; }
        // A non-ok status often returns a non-empty error page; that is NOT the
        // asset's content, so surface it as an error with the status code.
        if (!res.ok) { setErrorDesc(`Server returned ${res.status ?? "an error"} — the body is an error page, not the asset.`); setState("error"); return; }
        if (!res.content) { setState("empty"); return; }
        setContent(pretty(res.content)); setTruncated(res.truncated); setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [asset.id, asset.url, asset.kind, objectUrl, waiting, fetchText]);

  if (waiting || state === "loading") return <Spinner label="Loading…" />;
  if (state === "error") return <FailCard asset={asset} title="Couldn't load content" desc={errorDesc} />;
  if (state === "empty") return <span className="text-sm text-slate-400">Empty response</span>;
  return <TextPreview content={content} truncated={truncated} />;
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
      <Loader2 size={22} className="animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function FailCard({ asset, title, desc, canDownload = true }: { asset: AssetRecord; title: string; desc: string; canDownload?: boolean }) {
  const { downloadAsset } = useInspectorStore();
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <AlertTriangle size={24} className="text-amber-500" />
      <span className="text-sm font-medium text-slate-700">{title}</span>
      <span className="max-w-[300px] text-xs text-slate-400">{desc}</span>
      <div className="mt-1 flex items-center gap-2">
        {canDownload && (
          <button className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700" onClick={() => void downloadAsset(asset.url, safeFilename(asset.url, asset.id), asset.id)}>
            <Download size={13} /> Download
          </button>
        )}
        {!asset.url.startsWith("blob:") && (
          <button className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50" onClick={() => chrome.tabs.create({ url: asset.url })}>
            <ExternalLink size={13} /> Open
          </button>
        )}
      </div>
    </div>
  );
}

function dataUrlToObjectUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  const mime = /data:([^;]+)/.exec(dataUrl.slice(0, comma))?.[1] ?? "application/octet-stream";
  const bytes = base64ToBytes(dataUrl.slice(comma + 1));
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
}

function FontPreview({ url, asset }: { url: string; asset: AssetRecord }) {
  const id = useRef(`preview-font-${Math.round(performance.now())}-${url.length}`);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    const face = new FontFace(id.current, `url(${CSS.escape(url)})`);
    const timer = window.setTimeout(() => { if (!cancelled) setState("failed"); }, 6000);
    face.load().then((f) => {
      if (cancelled) return;
      document.fonts.add(f);
      setState("ready");
      window.clearTimeout(timer);
    }).catch(() => {
      if (!cancelled) setState("failed");
      window.clearTimeout(timer);
    });
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [url]);

  if (state === "loading") return <Spinner label="Loading font…" />;
  if (state === "failed") return <FailCard asset={asset} title="Couldn't load font" desc="The font didn't load (CORS, format, or a revoked URL). Download to inspect it." />;

  return (
    <div style={{ fontFamily: id.current }} className="space-y-2 text-center text-slate-700">
      <div className="text-2xl">The quick brown fox jumps over the lazy dog</div>
      <div className="text-base">ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789</div>
      <div className="text-sm">abcdefghijklmnopqrstuvwxyz !@#$%&amp;</div>
    </div>
  );
}

function ModelPreview({ asset, src }: { asset: AssetRecord; src: string }) {
  if (!isModelViewerCompatible(asset.url, asset.mime)) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-slate-500">
        <Box size={32} />
        <span className="text-sm font-medium">3D Model ({asset.extension?.toUpperCase() ?? asset.kind})</span>
        <span className="text-xs">Live preview available for glTF / GLB files only</span>
      </div>
    );
  }

  return (
    <model-viewer
      src={src}
      alt="3D model preview"
      auto-rotate=""
      camera-controls=""
      loading="lazy"
      style={{ width: "100%", height: "300px" }}
    />
  );
}

function TextPreview({ content, truncated }: { content: string | null; truncated?: boolean }) {
  if (content === null) return <span className="text-sm text-slate-500">Loading…</span>;
  const RENDER_CAP = 20000;
  const cut = truncated || content.length > RENDER_CAP;
  return (
    <div className="max-h-[320px] w-full overflow-auto rounded-md bg-slate-900 p-3">
      <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-slate-100">{content.slice(0, RENDER_CAP)}</pre>
      {cut && <div className="pt-2 text-center text-[10px] text-slate-400">… truncated for display</div>}
    </div>
  );
}

function MetaRow({ label, value, mono, clickable }: { label: string; value: string; mono?: boolean; clickable?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 pt-px text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="min-w-0 flex-1">
        {clickable ? (
          <a
            href={value}
            className="block min-w-0 break-all font-mono text-xs text-accent hover:underline"
            title="Open in new tab"
            onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: value }); }}
          >
            {value}
          </a>
        ) : (
          <span className={`block min-w-0 break-all capitalize text-slate-700 ${mono ? "font-mono text-xs normal-case" : "text-sm"}`}>{value}</span>
        )}
      </dd>
    </div>
  );
}

function describeUrl(url: string): { primary: string; secondary: string } {
  if (url.startsWith("data:")) {
    const mime = /^data:([^;,]+)/i.exec(url)?.[1] ?? "data";
    return { primary: `data: ${mime}`, secondary: `${url.length.toLocaleString()} chars` };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "blob:") {
      return { primary: "blob object", secondary: parsed.pathname.replace(/^\//, "").slice(0, 64) };
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.pop();
    const dir = segments.length ? `/${segments.join("/")}/` : "/";
    return { primary: last || parsed.hostname, secondary: `${parsed.hostname}${last ? dir : ""}` };
  } catch {
    return { primary: url.slice(0, 64), secondary: "" };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function statusClass(status?: number): StatusFilter {
  if (status == null) return "no-status";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client-error";
  if (status >= 500) return "server-error";
  return "no-status";
}

// Comparator with missing values always sorting last (regardless of direction),
// so e.g. sorting by size doesn't float a wall of unknown-size rows to the top.
function compareAssets(a: AssetRecord, b: AssetRecord, key: SortKey, dir: number): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  const aMissing = av === undefined || av === "";
  const bMissing = bv === undefined || bv === "";
  // Direction-independent tiebreaker on id so ties don't reshuffle as updatedAt
  // churns under the 1.5s refresh (the rendered order stays a pure function of the set).
  if (aMissing && bMissing) return a.id.localeCompare(b.id);
  if (aMissing) return 1;
  if (bMissing) return -1;
  const primary = typeof av === "string" && typeof bv === "string" ? dir * av.localeCompare(bv) : dir * (Number(av) - Number(bv));
  return primary !== 0 ? primary : a.id.localeCompare(b.id);
}

function sortValue(asset: AssetRecord, key: SortKey): string | number | undefined {
  switch (key) {
    case "size": return asset.size;
    case "status": return asset.status;
    case "name": return describeUrl(asset.url).primary.toLowerCase();
    case "kind": return asset.kind;
    case "createdAt": return asset.createdAt;
    case "updatedAt":
    default: return asset.updatedAt;
  }
}

function countByKind(assets: AssetRecord[]): Record<AssetKind, number> {
  return assets.reduce((counts, asset) => {
    counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
    return counts;
  }, {} as Record<AssetKind, number>);
}
