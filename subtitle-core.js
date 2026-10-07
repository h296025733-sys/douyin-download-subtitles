(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DouyinSubtitleCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CDN_HOSTS = ["douyin.com", "douyinvod.com", "toutiaovod.com", "zjcdn.com", "bytevcloudcdn.com", "volccdn.com", "bytetos.com", "ibytedtos.com", "byteimg.com"];

  function trustedUrl(value) {
    if (typeof value !== "string" || value.length > 12000) return null;
    try {
      const url = new URL(value.replace(/&amp;/g, "&"));
      if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
      url.hash = "";
      return CDN_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
    } catch (_) { return null; }
  }

  function cleanText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/\r/g, "").replace(/\n{2,}/g, "\n").trim().slice(0, 6000);
  }

  function normalizeSegments(input, duration = 0) {
    if (!Array.isArray(input)) return [];
    const limit = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    const rows = input.slice(0, 6000).map((row) => ({
      start: row?.start == null ? NaN : Number(row.start),
      end: row?.end == null ? NaN : Number(row.end),
      text: cleanText(row?.text)
    })).filter((row) => row.text && Number.isFinite(row.start) && row.start >= 0 && row.start < limit)
      .sort((a, b) => a.start - b.start);
    const seen = new Set();
    return rows.flatMap((row, index) => {
      const next = rows[index + 1]?.start;
      const fallback = Number.isFinite(next) && next > row.start ? next : (limit !== Infinity ? limit : row.start + 2);
      const end = Math.min(limit, Number.isFinite(row.end) && row.end > row.start ? row.end : fallback);
      if (end <= row.start) return [];
      const result = { start: Math.round(row.start * 1000) / 1000, end: Math.round(end * 1000) / 1000, text: row.text };
      if (result.end <= result.start) result.end = result.start + 0.001;
      const key = `${result.start}|${result.end}|${result.text}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [result];
    });
  }

  function timestamp(seconds, srt = false) {
    const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const pad = (n, size = 2) => String(n).padStart(size, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${srt ? "," : "."}${pad(ms % 1000, 3)}`;
  }

  function toSrt(segments) {
    return normalizeSegments(segments).map((row, i) => `${i + 1}\r\n${timestamp(row.start, true)} --> ${timestamp(row.end, true)}\r\n${row.text.replace(/\n/g, "\r\n")}`).join("\r\n\r\n") + "\r\n";
  }

  function parseTime(value) {
    const parts = String(value).trim().replace(",", ".").split(":");
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
  }

  function parseSubtitleFile(source, duration = 0) {
    if (typeof source !== "string" || source.length > 2000000) return [];
    const text = source.replace(/^\uFEFF/, "").trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const data = JSON.parse(text);
        const rows = Array.isArray(data) ? data : data.utterances ?? data.subtitles ?? data.captions ?? data.segments ?? data.data?.utterances;
        if (!Array.isArray(rows)) return [];
        return normalizeSegments(rows.map((row) => ({
          start: row.start_time != null ? Number(row.start_time) / 1000 : row.start,
          end: row.end_time != null ? Number(row.end_time) / 1000 : row.end,
          text: row.text ?? row.content ?? row.utterance
        })), duration);
      } catch (_) { return []; }
    }
    const rows = [];
    for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
      const lines = block.split("\n");
      const i = lines.findIndex((line) => line.includes("-->"));
      if (i < 0) continue;
      const match = lines[i].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
      if (match) rows.push({ start: parseTime(match[1]), end: parseTime(match[2]), text: lines.slice(i + 1).join("\n") });
    }
    return normalizeSegments(rows, duration);
  }

  // Only enter subtitle-specific containers belonging to this item. Never scan
  // arbitrary URLs/descriptions: those can be covers, music or another video.
  const CAPTION_KEYS = ["caption_infos", "captionInfos", "caption_info", "captionInfo", "subtitle_infos", "subtitleInfos", "subtitle_info", "subtitleInfo", "subtitle_list", "subtitleList", "subtitles", "captions", "auto_captions", "autoCaptions", "auto_video_caption_info", "autoVideoCaptionInfo"];

  function captionContainers(detail) {
    const result = [];
    const video = detail?.video;
    const owners = [detail, video, detail?.cla_info, detail?.claInfo, video?.cla_info, video?.claInfo];
    for (const owner of owners) {
      if (!owner || typeof owner !== "object") continue;
      for (const key of CAPTION_KEYS) if (owner[key]) result.push(owner[key]);
    }
    const stickers = detail?.interaction_stickers ?? detail?.interactionStickers;
    for (const sticker of Array.isArray(stickers) ? stickers.slice(0, 100) : []) {
      if (sticker?.auto_video_caption_info) result.push(sticker.auto_video_caption_info);
      if (sticker?.autoVideoCaptionInfo) result.push(sticker.autoVideoCaptionInfo);
    }
    return result;
  }

  function visitCaptions(detail, visitor) {
    const queue = captionContainers(detail).map((value) => ({ value, depth: 0 }));
    const seen = new WeakSet();
    let visited = 0;
    while (queue.length && visited++ < 500) {
      let { value, depth } = queue.shift();
      if (depth > 7) continue;
      if (typeof value === "string" && value.length <= 2000000) {
        try { value = JSON.parse(value); } catch (_) { continue; }
      }
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const child of value.slice(0, 100)) queue.push({ value: child, depth: depth + 1 });
      } else {
        visitor(value);
        for (const key of CAPTION_KEYS) if (value[key]) queue.push({ value: value[key], depth: depth + 1 });
      }
    }
  }

  function extractTracks(detail) {
    const found = new Map();
    const cla = detail?.video?.cla_info ?? detail?.video?.claInfo ?? {};
    const originalLanguage = String((cla.original_language_info ?? cla.originalLanguageInfo)?.language ?? "").toLowerCase();
    const addressKeys = ["url", "Url", "src", "caption_url", "captionUrl", "subtitle_url", "subtitleUrl", "url_list", "urlList", "UrlList"];
    function addressUrls(value, depth = 0) {
      if (depth > 4) return [];
      if (typeof value === "string") return [trustedUrl(value)].filter(Boolean);
      if (!value || typeof value !== "object") return [];
      if (Array.isArray(value)) return value.slice(0, 12).flatMap((entry) => addressUrls(entry, depth + 1));
      return addressKeys.flatMap((key) => addressUrls(value[key], depth + 1));
    }
    visitCaptions(detail, (track) => {
      const language = String(track.language ?? track.lang ?? track.LanguageCodeName ?? track.languageCodeName ?? track.language_code_name ?? "").slice(0, 40);
      const format = String(track.Format ?? track.format ?? "").slice(0, 30);
      for (const url of addressKeys.flatMap((key) => addressUrls(track[key]))) {
        found.set(url, { url, language, format, original: Boolean(originalLanguage && language.toLowerCase() === originalLanguage) });
      }
    });
    const rank = (track) => Number(track.original) * 4 + Number(/^(zh|cmn)(?:[-_]|$)/i.test(track.language)) * 2 + Number(/webvtt|srt/i.test(track.format));
    return [...found.values()].sort((a, b) => rank(b) - rank(a)).slice(0, 12);
  }

  function extractInlineSegments(detail) {
    let best = [];
    visitCaptions(detail, (value) => {
      try {
        const rows = parseSubtitleFile(JSON.stringify(value));
        if (rows.length > best.length) best = rows;
      } catch (_) { /* React state can contain a cycle; a URL track remains usable. */ }
    });
    return best;
  }

  function mergeItems(previous, next) {
    if (!previous || previous.awemeId !== next.awemeId) return next;
    const tracks = new Map();
    for (const track of [...(next.subtitleTracks || []), ...(previous.subtitleTracks || [])]) {
      if (trustedUrl(track?.url) && !tracks.has(track.url)) tracks.set(track.url, track);
    }
    const before = previous.nativeSegments || [], after = next.nativeSegments || [];
    const merged = { ...previous, ...next, title: next.title || previous.title || "", url: next.url || previous.url || "" };
    if (tracks.size) merged.subtitleTracks = [...tracks.values()].slice(0, 12);
    if (before.length || after.length) merged.nativeSegments = after.length >= before.length ? after : before;
    return merged;
  }

  return Object.freeze({ trustedUrl, cleanText, normalizeSegments, timestamp, toSrt, parseSubtitleFile, extractTracks, extractInlineSegments, mergeItems });
});
