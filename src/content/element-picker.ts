import type { RuntimeMessage } from "../shared/messages";
import { cssSelector, extractAssetUrls, inferAssetLabel } from "./asset-detection";

let active = false;
let shadowHost: HTMLElement | null = null;
let highlight: HTMLDivElement | null = null;
let badge: HTMLDivElement | null = null;
let tooltip: HTMLDivElement | null = null;
let cursorStyle: HTMLStyleElement | null = null;
let currentTarget: Element | null = null;

export function activatePicker(): void {
  if (active) return;
  active = true;

  if (!cursorStyle) {
    cursorStyle = document.createElement("style");
    cursorStyle.textContent = "html.__asset-picker-active, html.__asset-picker-active * { cursor: crosshair !important; }";
    document.head.appendChild(cursorStyle);
  }
  document.documentElement.classList.add("__asset-picker-active");

  const container = createOverlay();
  shadowHost = container.host;
  highlight = container.highlight;
  badge = container.badge;
  tooltip = container.tooltip;

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}

export function deactivatePicker(): void {
  if (!active) return;
  active = false;
  currentTarget = null;

  document.documentElement.classList.remove("__asset-picker-active");
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKeyDown, true);

  if (shadowHost) {
    shadowHost.remove();
    shadowHost = null;
    highlight = null;
    badge = null;
    tooltip = null;
  }
}

function createOverlay() {
  const host = document.createElement("div");
  host.id = "__asset-lens-picker";
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });

  const hl = document.createElement("div");
  hl.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    "border:2.5px solid #0f766e",
    "background:rgba(15,118,110,0.15)",
    "border-radius:3px",
    "transition:top 50ms ease-out,left 50ms ease-out,width 50ms ease-out,height 50ms ease-out",
    "display:none",
    "z-index:2147483647",
    "box-shadow:0 0 0 1px rgba(15,118,110,0.3)"
  ].join(";") + ";";

  const bd = document.createElement("div");
  bd.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    "background:#0f766e",
    "color:#fff",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
    "font-size:10px",
    "font-weight:600",
    "line-height:1",
    "padding:2px 6px",
    "border-radius:2px",
    "display:none",
    "z-index:2147483647",
    "white-space:nowrap"
  ].join(";") + ";";

  const tt = document.createElement("div");
  tt.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    "background:#1e293b",
    "color:#f1f5f9",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
    "font-size:11px",
    "line-height:1.5",
    "padding:6px 10px",
    "border-radius:5px",
    "max-width:420px",
    "display:none",
    "z-index:2147483647",
    "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
    "overflow:hidden"
  ].join(";") + ";";

  root.appendChild(hl);
  root.appendChild(bd);
  root.appendChild(tt);
  document.documentElement.appendChild(host);

  return { host, highlight: hl, badge: bd, tooltip: tt };
}

// Walk up across shadow boundaries: when there is no parentElement we've hit a
// shadow root, so continue from its host — otherwise picking inside a web
// component would dead-end at the shadow boundary.
function ascend(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function findAssetElement(el: Element | null): { element: Element; urls: string[] } | null {
  let current = el;
  while (current && current !== document.documentElement) {
    const urls = extractAssetUrls(current, location.href);
    if (urls.length > 0) return { element: current, urls };
    current = ascend(current);
  }
  return null;
}

function onMouseMove(event: MouseEvent): void {
  // composedPath()[0] pierces shadow DOM to the real element under the cursor;
  // elementFromPoint only returns the shadow host.
  const path = event.composedPath();
  const target = (path[0] instanceof Element ? path[0] : document.elementFromPoint(event.clientX, event.clientY)) as Element | null;
  if (!target || target === shadowHost) {
    hideOverlay();
    return;
  }

  const found = findAssetElement(target);
  if (!found) {
    hideOverlay();
    currentTarget = null;
    return;
  }

  if (found.element === currentTarget) return;

  currentTarget = found.element;
  const rect = found.element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideOverlay();
    return;
  }

  if (highlight) {
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.style.display = "block";
  }

  const tag = found.element.tagName.toLowerCase();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);

  if (badge) {
    badge.textContent = `${tag}  ${w} × ${h}`;
    badge.style.display = "block";
    let badgeTop = rect.top - 18;
    if (badgeTop < 2) badgeTop = rect.bottom + 2;
    badge.style.top = `${badgeTop}px`;
    badge.style.left = `${rect.left}px`;
  }

  if (tooltip) {
    const label = inferAssetLabel(found.element);
    const url = found.urls[0];
    const truncated = url.length > 100 ? url.slice(0, 97) + "..." : url;
    const extra = found.urls.length > 1 ? `\n+${found.urls.length - 1} more asset(s)` : "";

    tooltip.innerHTML = "";
    const kindLine = document.createElement("div");
    kindLine.style.cssText = "color:#5eead4;font-weight:600;margin-bottom:2px;";
    kindLine.textContent = `${tag}  ·  ${label}  ·  ${w}×${h}`;
    const urlLine = document.createElement("div");
    urlLine.style.cssText = "color:#94a3b8;word-break:break-all;white-space:normal;";
    urlLine.textContent = truncated + extra;
    tooltip.appendChild(kindLine);
    tooltip.appendChild(urlLine);
    tooltip.style.display = "block";

    requestAnimationFrame(() => {
      if (!tooltip) return;
      const ttW = tooltip.offsetWidth;
      const ttH = tooltip.offsetHeight;
      let ttTop = rect.bottom + 8;
      if (ttTop + ttH > window.innerHeight) ttTop = rect.top - ttH - 8;
      if (ttTop < 4) ttTop = 4;
      let ttLeft = rect.left;
      if (ttLeft + ttW > window.innerWidth) ttLeft = window.innerWidth - ttW - 8;
      if (ttLeft < 4) ttLeft = 4;
      tooltip.style.top = `${ttTop}px`;
      tooltip.style.left = `${ttLeft}px`;
    });
  }
}

function onClick(event: MouseEvent): void {
  event.stopImmediatePropagation();
  event.preventDefault();

  if (!currentTarget) return;

  const urls = extractAssetUrls(currentTarget, location.href);
  if (!urls.length) return;

  void chrome.runtime.sendMessage({
    type: "PICKER_RESULT",
    assetUrl: urls[0],
    cssSelector: cssSelector(currentTarget),
    pageUrl: location.href
  } satisfies RuntimeMessage);

  deactivatePicker();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopImmediatePropagation();
    event.preventDefault();
    void chrome.runtime.sendMessage({
      type: "PICKER_CANCELLED",
      pageUrl: location.href
    } satisfies RuntimeMessage);
    deactivatePicker();
  }
}

function hideOverlay(): void {
  if (highlight) highlight.style.display = "none";
  if (badge) badge.style.display = "none";
  if (tooltip) tooltip.style.display = "none";
  currentTarget = null;
}
