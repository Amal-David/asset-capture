import { normalizeUrl } from "../shared/url";

const XLINK_NS = "http://www.w3.org/1999/xlink";

export function extractAssetUrls(element: Element, baseUrl: string): string[] {
  const urls: string[] = [];

  for (const attr of ["src", "href", "poster", "data", "data-src", "data-lazy", "data-lazy-src", "data-original", "data-bg", "data-background", "data-poster", "data-thumb", "data-image"]) {
    const value = element.getAttribute(attr);
    if (value && !value.startsWith("#")) urls.push(normalizeUrl(value, baseUrl));
  }

  for (const attr of ["srcset", "imagesrcset", "data-srcset", "data-lazy-srcset"]) {
    const srcset = element.getAttribute(attr);
    if (srcset) parseSrcset(srcset).forEach((u) => urls.push(normalizeUrl(u, baseUrl)));
  }

  // SVG <image>/<use> reference assets via href / xlink:href.
  const tag = element.tagName.toLowerCase();
  if (tag === "image" || tag === "use") {
    const href = element.getAttribute("href") || element.getAttributeNS(XLINK_NS, "href");
    const clean = href && tag === "use" ? href.split("#")[0] : href;
    if (clean) urls.push(normalizeUrl(clean, baseUrl));
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
  const testId = element.getAttribute("data-testid");
  if (testId) return `${tag}[data-testid="${CSS.escape(testId)}"]`;
  const testAttr = element.getAttribute("data-test");
  if (testAttr) return `${tag}[data-test="${CSS.escape(testAttr)}"]`;
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
