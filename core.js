(function initDouyinDownloadCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DouyinDownloadCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const VIDEO_HOST_HINTS = [
    "douyinvod",
    "douyin.com",
    "zjcdn",
    "bytecdn",
    "byteimg",
    "bytedance",
    "bytetos",
    "ibytedtos",
    "volccdn",
    "bytevcloudcdn",
    "pstatp",
    "toutiaovod",
    "ixigua",
    "amemv",
    "snssdk"
  ];

  const VIDEO_CDN_HINTS = [
    "douyinvod",
    "toutiaovod",
    "bytevcloudcdn",
    "volccdn",
    "zjcdn",
    "bytetos",
    "ibytedtos"
  ];

  const ALLOWED_MEDIA_HOSTS = [
    "douyinvod.com",
    "toutiaovod.com",
    "zjcdn.com",
    "bytevcloudcdn.com",
    "volccdn.com",
    "bytetos.com",
    "ibytedtos.com"
  ];

  const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

  function normalizeCandidateUrl(rawValue, baseUrl) {
    if (typeof rawValue !== "string") {
      return null;
    }

    let value = rawValue.trim();
    if (!value || value.length > 12000) {
      return null;
    }

    value = value
      .replace(/&amp;/gi, "&")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/");

    if (/^https?%3a/i.test(value)) {
      try {
        value = decodeURIComponent(value);
      } catch (_error) {
        return null;
      }
    }

    if (value.startsWith("//")) {
      value = `https:${value}`;
    }

    // Media URLs in page data are expected to be absolute. Rejecting relative
    // strings prevents titles/IDs from becoming fake douyin.com page URLs.
    if (!/^https:\/\//i.test(value)) {
      return null;
    }

    let parsed;
    try {
      parsed = new URL(value, baseUrl || "https://www.douyin.com/");
    } catch (_error) {
      return null;
    }

    if (parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";
    return parsed.href;
  }

  function isUnsupportedStream(url) {
    if (typeof url !== "string") {
      return true;
    }

    return (
      /(?:\.m3u8|\.mpd|\.m4s|\.cmfv|\.cmfa|\.ts|\.aac|\.m4a)(?:$|[?#])/i.test(url) ||
      /(?:^|[/_.-])(?:init|chunk|segment|fragment|frag)[_.-]/i.test(url) ||
      /(?:[?&])(?:range|byte_range|segment|fragment|init)=[^&]*/i.test(url) ||
      /(?:format|mime_type)=(?:dash|hls)/i.test(url) ||
      /(?:track_type|media_type)=(?:audio|dash|hls)/i.test(url)
    );
  }

  function isKnownWatermarked(url, context) {
    const combined = `${url || ""} ${context || ""}`.toLowerCase();

    if (combined.includes("without_watermark") || combined.includes("withoutwatermark")) {
      return false;
    }

    return /(?:playwm|watermark(?:ed)?[=_:/-]?1|download_addr|downloadaddr)/i.test(combined);
  }

  function makeLegacyCleanUrl(url) {
    if (typeof url !== "string") {
      return null;
    }

    let clean = url
      .replace(/\/playwm\//gi, "/play/")
      .replace(/([?&])watermark=1(?=&|$)/gi, "$1watermark=0");

    clean = clean.replace(/[?&]$/, "");
    return clean === url ? null : clean;
  }

  function isLikelyMediaUrl(url, context) {
    if (typeof url !== "string" || !url.startsWith("https://") || isUnsupportedStream(url)) {
      return false;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    const lowerUrl = url.toLowerCase();
    const lowerContext = String(context || "").toLowerCase();

    if (/\.(?:jpe?g|png|webp|gif|avif|svg|html?)(?:$|[?#])/i.test(url)) return false;
    if (/\/play\/dash\/|\/media-(?:video|audio)-/i.test(url)) return false;
    if (/\b(?:audio|music|avatar|cover|poster|image)\b/i.test(`${lowerUrl} ${lowerContext}`)) return false;

    const isDouyinHost = hostname === "douyin.com" || hostname.endsWith(".douyin.com");
    const isObviousPageRoute = /^\/(?:video|search|user|recommend|follow|channel)(?:\/|$)/i.test(parsed.pathname);
    const hasPlaybackSignal =
      /\.mp4(?:$|[?#])|mime_type=video_mp4|video_id=|\/video\/tos\/|\/aweme\/v1\/play\//i.test(url);

    if (isDouyinHost && isObviousPageRoute && !hasPlaybackSignal) return false;
    if (hasPlaybackSignal) return true;
    if (VIDEO_CDN_HINTS.some((hint) => hostname.includes(hint))) return true;

    return (
      /(?:videoelement|sourceelement|performance:video)/i.test(context || "") &&
      VIDEO_HOST_HINTS.some((hint) => hostname.includes(hint))
    );
  }

  function isAllowedMediaHost(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return false;
      const hostname = parsed.hostname.toLowerCase();
      if (ALLOWED_MEDIA_HOSTS.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
        return true;
      }
      return (
        (hostname === "douyin.com" || hostname.endsWith(".douyin.com")) &&
        /\/aweme\/v1\/play\//i.test(parsed.pathname)
      );
    } catch (_error) {
      return false;
    }
  }

  function scoreMediaUrl(url, context) {
    if (!isLikelyMediaUrl(url, context)) {
      return -Infinity;
    }

    const lowerUrl = url.toLowerCase();
    const lowerContext = String(context || "").toLowerCase();
    let score = 0;

    if (VIDEO_HOST_HINTS.some((hint) => lowerUrl.includes(hint))) score += 55;
    if (/\.mp4(?:$|[?#])/i.test(url)) score += 55;
    if (/mime_type=video_mp4|video[_-]?size|video_id=|\/video\/tos\//i.test(url)) score += 45;
    if (/\bvideo\b|playaddr|play_addr|playurl|play_url|bitrate|bit_rate/i.test(lowerContext)) score += 40;
    if (/currentSrc|videoElement|sourceElement/i.test(context || "")) score += 140;
    if (/performance:video/i.test(context || "")) score += 90;
    if (/without.?watermark/i.test(`${lowerUrl} ${lowerContext}`)) score += 70;

    if (/\.(?:jpe?g|png|webp|gif|avif)(?:$|[?#])/i.test(url)) score -= 240;
    if (/\b(?:audio|music|avatar|cover|poster|image)\b/i.test(`${lowerUrl} ${lowerContext}`)) score -= 100;
    if (isKnownWatermarked(url, context)) score -= 260;

    return score;
  }

  function getVideoId(pageUrl) {
    if (typeof pageUrl !== "string") {
      return "";
    }

    try {
      const parsed = new URL(pageUrl);
      const pathMatch = parsed.pathname.match(/\/video\/(\d{8,})/);
      return pathMatch?.[1] || parsed.searchParams.get("modal_id") || parsed.searchParams.get("aweme_id") || "";
    } catch (_error) {
      return "";
    }
  }

  function isDouyinPage(pageUrl) {
    try {
      const hostname = new URL(pageUrl).hostname.toLowerCase();
      return hostname === "douyin.com" || hostname.endsWith(".douyin.com");
    } catch (_error) {
      return false;
    }
  }

  function sanitizeFilename(title, videoId) {
    const fallbackId = String(videoId || "").replace(/\D/g, "").slice(0, 30);
    let base = String(title || "")
      .normalize("NFKC")
      .replace(/\s*[-—_｜|]\s*抖音(?:网页版)?\s*$/i, "")
      .replace(/\.mp4\s*$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\.\.+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[. ]+|[. ]+$/g, "");

    base = Array.from(base).slice(0, 100).join("").trim().replace(/[. ]+$/g, "");

    if (!base) {
      base = fallbackId ? `抖音视频_${fallbackId}` : `抖音视频_${Date.now()}`;
    }

    if (RESERVED_WINDOWS_NAMES.test(base)) {
      base = `_${base}`;
    }

    return `${base}.mp4`;
  }

  return Object.freeze({
    getVideoId,
    isAllowedMediaHost,
    isDouyinPage,
    isKnownWatermarked,
    isLikelyMediaUrl,
    isUnsupportedStream,
    makeLegacyCleanUrl,
    normalizeCandidateUrl,
    sanitizeFilename,
    scoreMediaUrl
  });
});
