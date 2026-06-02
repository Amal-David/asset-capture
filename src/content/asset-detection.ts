import { normalizeUrl } from "../shared/url";

export function extractAssetUrls(element: Element, baseUrl: string): string[] {
  const urls: string[] = [];

  for (const attr of ["src", "href", "poster", "data"]) {
    const value = element.getAttribute(attr);
    if (value) urls.push(normalizeUrl(value, baseUrl));
  }

  for (const attr of ["srcset", "imagesrcset"]) {
    const srcset = element.getAttribute(attr);
    if (srcset) parseSrcset(srcset).forEach((u) => urls.push(normalizeUrl(u, baseUrl)));
  }

  const style = element.getAttribute("style");
  if (style) extractCssUrls(style, baseUrl).forEach((u) => urls.push(u));

  return urls;
}

export function parseSrcset(srcset: string): string[] {
  return srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

export function extractCssUrls(style: string, baseUrl: string): string[] {
  return Array.from(style.matchAll(/url\((['"]?)(.*?)\1\)/gi))
    .map((match) => match[2])
    .filter(Boolean)
    .map((url) => normalizeUrl(url, baseUrl));
}

export function cssSelector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const tag = element.tagName.toLowerCase();
  const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
  if (testId) return `${tag}[data-testid="${CSS.escape(testId)}"]`;
  const parent = element.parentElement;
  if (!parent) return tag;
  const index = Array.from(parent.children).indexOf(element) + 1;
  return `${tag}:nth-child(${index})`;
}

export function inferAssetLabel(element: Element): string {
  const tag = element.tagName.toUpperCase();
  if (tag === "IMG") return "image";
  if (tag === "VIDEO" || tag === "AUDIO") return tag.toLowerCase();
  if (tag === "SOURCE") return (element.closest("video") ? "video" : element.closest("audio") ? "audio" : "media");
  if (tag === "LINK") return "stylesheet";
  if (tag === "SCRIPT") return "script";
  if (tag === "IFRAME" || tag === "EMBED" || tag === "OBJECT") return "embed";
  return "asset";
}
