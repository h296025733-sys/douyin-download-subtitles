(function initDouyinCaptureCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DouyinCaptureCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCaptureCore() {
  "use strict";

  function parsePayload(rawPayload) {
    if (rawPayload && typeof rawPayload === "object") return rawPayload;
    if (typeof rawPayload !== "string" || rawPayload.length > 30000000) return null;

    let text = rawPayload.trim().replace(/^\)]}',?\s*/, "");
    if (/^%7b|^%5b/i.test(text)) {
      try { text = decodeURIComponent(text); } catch (_) { return null; }
    }
    if (!text.startsWith("{") && !text.startsWith("[")) return null;

    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function normalizePlayUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length > 12000) return null;

    let value = rawUrl
      .trim()
      .replace(/&amp;/gi, "&")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/");
    if (value.startsWith("//")) value = `https:${value}`;

    let parsed;
    try {
      parsed = new URL(value);
    } catch (_error) {
      return null;
    }

    if (parsed.protocol !== "https:") return null;
    if (/playwm|watermark=1|(?:\.m3u8|\.mpd|\.m4s)(?:$|[?#])|\/play\/dash\/|\/media-(?:video|audio)-/i.test(parsed.href)) {
      return null;
    }
    parsed.hash = "";
    return parsed.href;
  }

  function extractFromDetail(detail) {
    if (!detail || typeof detail !== "object") return null;

    const awemeId = String(detail.aweme_id ?? detail.awemeId ?? "");
    if (!/^\d{8,30}$/.test(awemeId)) return null;

    const video = detail.video;
    if (!video || typeof video !== "object") return null;

    // play_addr is the regular combined playback MP4. Deliberately do not use
    // download_addr (watermarked) or DASH/bit-rate tracks (often video-only).
    const playAddress = video.play_addr ?? video.playAddr;
    const rawUrls = [];

    function collectAddressUrls(value, depth) {
      if (value == null || depth > 4) return;
      if (typeof value === "string") {
        rawUrls.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const child of value.slice(0, 20)) collectAddressUrls(child, depth + 1);
        return;
      }
      if (typeof value !== "object") return;

      for (const key of ["src", "url", "url_list", "urlList", "urls"]) {
        if (key in value) collectAddressUrls(value[key], depth + 1);
      }
    }

    collectAddressUrls(playAddress, 0);
    const url = rawUrls.map(normalizePlayUrl).find(Boolean);
    if (!url) return null;

    const rawTitle = detail.desc ?? detail.item_title ?? detail.itemTitle ?? detail.caption;
    const title = typeof rawTitle === "string" ? rawTitle.slice(0, 1000) : "";
    const item = { awemeId, title, url };
    const tracks = globalThis.DouyinSubtitleCore?.extractTracks(detail);
    if (tracks?.length) item.subtitleTracks = tracks;
    return item;
  }

  function extractSubtitleItem(detail) {
    if (!detail || typeof detail !== "object") return null;
    const awemeId = String(detail.aweme_id ?? detail.awemeId ?? detail.item_id ?? detail.itemId ?? "");
    if (!/^\d{8,30}$/.test(awemeId)) return null;
    const subtitles = globalThis.DouyinSubtitleCore;
    const subtitleTracks = subtitles?.extractTracks(detail) || [];
    const nativeSegments = subtitles?.extractInlineSegments(detail) || [];
    if (!subtitleTracks.length && !nativeSegments.length) return null;
    return { awemeId, title: String(detail.desc ?? detail.item_title ?? detail.itemTitle ?? "").slice(0, 1000), url: "", subtitleTracks, nativeSegments };
  }

  function extractItems(rawPayload, extractor) {
    const payload = parsePayload(rawPayload);
    if (!payload) return [];

    const found = new Map();
    const queue = [payload];
    const seen = new WeakSet();
    let visited = 0;

    while (queue.length && visited < 12000) {
      const value = queue.shift();
      visited += 1;
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      let item = null;
      try {
        item = extractor(value);
      } catch (_error) {
        item = null;
      }
      if (item) found.set(item.awemeId, globalThis.DouyinSubtitleCore?.mergeItems(found.get(item.awemeId), item) || item);

      let children;
      try {
        children = Array.isArray(value) ? value.slice(0, 300) : Object.values(value);
      } catch (_error) {
        continue;
      }

      for (const child of children) {
        if (child && typeof child === "object") queue.push(child);
      }
    }

    return Array.from(found.values());
  }

  function extractPlayableItems(rawPayload) { return extractItems(rawPayload, extractFromDetail); }
  function extractSubtitleItems(rawPayload) { return extractItems(rawPayload, extractSubtitleItem); }

  return Object.freeze({ extractPlayableItems, extractSubtitleItems, normalizePlayUrl, parsePayload });
});
