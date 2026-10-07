(function initDouyinDownloader() {
  "use strict";

  if (window.top !== window || document.getElementById("douyin-simple-downloader-host")) {
    return;
  }

  const core = globalThis.DouyinDownloadCore;
  const captureBridge = globalThis.__DouyinSimpleDownloadBridge;
  const candidates = new Map();
  const capturedById = new Map();
  let busy = false;
  let lastDownloadId = null;
  let visibilityTimer = 0;
  let subtitleCaptureId = "";
  let subtitleCaptureAt = 0;

  const host = document.createElement("div");
  host.id = "douyin-simple-downloader-host";
  host.style.cssText = "all:initial;position:fixed;right:24px;bottom:96px;z-index:2147483647;display:none";

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      button {
        box-sizing: border-box;
        min-width: 116px;
        height: 42px;
        padding: 0 17px;
        border: 0;
        border-radius: 21px;
        background: #fe2c55;
        color: #fff;
        font: 600 14px/42px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        letter-spacing: .2px;
        text-align: center;
        white-space: nowrap;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, .22);
        transition: transform .15s ease, filter .15s ease, opacity .15s ease;
      }
      button:hover { filter: brightness(1.06); transform: translateY(-1px); }
      button:active { transform: translateY(0); }
      button:disabled { cursor: wait; opacity: .78; transform: none; }
      button[data-state="success"] { background: #21b66f; }
      button[data-state="error"] { background: #2f3035; }
      .detail {
        box-sizing: border-box;
        max-width: 280px;
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 9px;
        background: rgba(24, 25, 29, .94);
        color: #fff;
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        overflow-wrap: anywhere;
        box-shadow: 0 5px 18px rgba(0, 0, 0, .22);
      }
      .detail[hidden] { display: none; }
      .actions { display: flex; gap: 8px; justify-content: flex-end; }
      .subtitles { background: #25262c; }
    </style>
    <div class="actions">
      <button class="subtitles" type="button" title="打开带时间戳的口播字幕面板">口播字幕</button>
      <button class="download" type="button" title="下载当前播放的视频">↓ 下载视频</button>
    </div>
    <div class="detail" hidden></div>
  `;

  const button = shadow.querySelector(".download");
  const subtitleButton = shadow.querySelector(".subtitles");
  const detail = shadow.querySelector(".detail");
  (document.documentElement || document.body).appendChild(host);

  function getCurrentVideoId(video = findCurrentVideo()) {
    let node = video;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      const match = String(node.className || "").match(/(?:^|\s)video_(\d{8,30})(?:\s|$)/);
      if (match) return match[1];
    }
    const routeId = core.getVideoId(location.href);
    return /^\d{8,30}$/.test(routeId) ? routeId : "";
  }

  function acceptCapturedItem(item) {
    const awemeId = String(item?.awemeId || "");
    if (!/^\d{8,30}$/.test(awemeId)) return;

    const subtitleCore = globalThis.DouyinSubtitleCore;
    const candidateUrl = core.normalizeCandidateUrl(item.url);
    const url = candidateUrl && core.isAllowedMediaHost(candidateUrl) && core.isLikelyMediaUrl(candidateUrl, "captured:play_addr") && !core.isKnownWatermarked(candidateUrl, "captured:play_addr") ? candidateUrl : "";
    const subtitleTracks = (Array.isArray(item.subtitleTracks) ? item.subtitleTracks : []).filter((track) => subtitleCore.trustedUrl(track?.url)).slice(0, 12);
    const nativeSegments = subtitleCore.normalizeSegments(item.nativeSegments);
    if (!url && !subtitleTracks.length && !nativeSegments.length) return;
    capturedById.set(awemeId, subtitleCore.mergeItems(capturedById.get(awemeId), {
      awemeId,
      title: String(item.title || "").slice(0, 1000),
      url,
      subtitleTracks,
      nativeSegments
    }));
    while (capturedById.size > 100) capturedById.delete(capturedById.keys().next().value);
  }

  if (captureBridge) {
    for (const item of captureBridge.queue.splice(0)) acceptCapturedItem(item);
    captureBridge.subscribe(acceptCapturedItem);
    captureBridge.request(getCurrentVideoId());
  }

  function setButton(label, state, disabled) {
    button.textContent = label;
    button.dataset.state = state || "idle";
    button.disabled = Boolean(disabled);
  }

  function showDetail(message) {
    detail.textContent = String(message || "").slice(0, 300);
    detail.hidden = !detail.textContent;
  }

  function restoreButton(delay) {
    window.setTimeout(() => {
      setButton("↓ 下载视频", "idle", false);
      showDetail("");
      busy = false;
    }, delay);
  }

  function elementVisibleArea(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (
      rect.width < 100 ||
      rect.height < 100 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return { area: 0, rect };
    }

    let ancestor = element.parentElement;
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      const ancestorStyle = window.getComputedStyle(ancestor);
      if (
        ancestorStyle.display === "none" ||
        ancestorStyle.visibility === "hidden" ||
        Number(ancestorStyle.opacity) === 0
      ) {
        return { area: 0, rect };
      }
    }

    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return { area: width * height, rect };
  }

  function findCurrentVideo() {
    let best = null;
    let bestScore = -Infinity;
    const viewportCenterX = innerWidth / 2;
    const viewportCenterY = innerHeight / 2;

    for (const video of document.querySelectorAll("video")) {
      const { area, rect } = elementVisibleArea(video);
      if (!area) continue;

      const containsCenter =
        rect.left <= viewportCenterX && rect.right >= viewportCenterX &&
        rect.top <= viewportCenterY && rect.bottom >= viewportCenterY;
      const distance = Math.hypot(
        rect.left + rect.width / 2 - viewportCenterX,
        rect.top + rect.height / 2 - viewportCenterY
      );
      const inVisibleDialog = Boolean(video.closest('[role="dialog"]'));
      const score =
        area +
        (!video.paused && !video.ended ? 180000 : 0) +
        (containsCenter ? 450000 : 0) +
        (inVisibleDialog ? 300000 : 0) -
        distance;

      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }

    return best;
  }

  function addCandidate(rawUrl, context, boost) {
    const normalized = core.normalizeCandidateUrl(rawUrl, location.href);
    if (!normalized || core.isUnsupportedStream(normalized)) return;

    if (core.isKnownWatermarked(normalized, context)) {
      const cleanUrl = core.makeLegacyCleanUrl(normalized);
      if (cleanUrl) {
        addCandidate(cleanUrl, `${context}:legacyClean`, (boost || 0) - 15);
      }
      return;
    }

    const score = core.scoreMediaUrl(normalized, context) + (boost || 0);
    if (!Number.isFinite(score) || score < 20) return;

    const previous = candidates.get(normalized);
    if (!previous || previous.score < score) {
      candidates.set(normalized, { url: normalized, context, score });
    }
  }

  function collectFromVideoElement(video) {
    if (!video) return;

    addCandidate(video.currentSrc, "videoElement:currentSrc", 400);
    addCandidate(video.src, "videoElement:src", 360);
    addCandidate(video.getAttribute("src"), "videoElement:srcAttribute", 340);

    for (const source of video.querySelectorAll("source")) {
      addCandidate(source.src, "sourceElement:src", 320);
      addCandidate(source.getAttribute("src"), "sourceElement:srcAttribute", 300);
    }
  }

  function collectFromMetadata() {
    const selectors = [
      'meta[property="og:video:url"]',
      'meta[property="og:video:secure_url"]',
      'meta[property="og:video"]',
      'meta[itemprop="contentUrl"]'
    ];

    for (const selector of selectors) {
      for (const meta of document.querySelectorAll(selector)) {
        addCandidate(meta.content, `metadata:${selector}`, 160);
      }
    }
  }

  function collectFromPerformance() {
    let entries = [];
    try {
      entries = performance.getEntriesByType("resource");
    } catch (_error) {
      return;
    }

    const start = Math.max(0, entries.length - 120);
    for (let index = start; index < entries.length; index += 1) {
      const entry = entries[index];
      const initiator = String(entry.initiatorType || "").toLowerCase();
      const context = initiator === "video" ? "performance:video" : `performance:${initiator || "resource"}`;
      const recencyBoost = Math.round(((index - start) / Math.max(1, entries.length - start)) * 70);
      const sizeBoost = Number(entry.transferSize) > 250000 ? 25 : 0;
      addCandidate(entry.name, context, recencyBoost + sizeBoost);
    }
  }

  function decodedJsonText(script) {
    const raw = (script.textContent || "").trim();
    if (!raw || raw.length > 16000000) return null;

    if (/^%7b|^%5b/i.test(raw)) {
      try {
        return decodeURIComponent(raw);
      } catch (_error) {
        return null;
      }
    }

    return raw;
  }

  function collectFromJsonScripts() {
    const pageVideoId = getCurrentVideoId();
    const scripts = Array.from(
      document.querySelectorAll('script[type="application/json"], script#RENDER_DATA, script#__NEXT_DATA__, script#__UNIVERSAL_DATA_FOR_REHYDRATION__')
    ).slice(0, 16);
    let visited = 0;

    function walk(value, path, matchedCurrentVideo, depth) {
      if (visited > 120000 || depth > 18 || value == null) return;
      visited += 1;

      if (typeof value === "string") {
        if (matchedCurrentVideo) addCandidate(value, `json:${path}`, 260);
        return;
      }

      if (typeof value !== "object") return;

      let matched = matchedCurrentVideo;
      if (!Array.isArray(value) && pageVideoId) {
        const ownId = value.aweme_id ?? value.awemeId ?? value.itemId ?? value.item_id;
        if (ownId != null && String(ownId) === pageVideoId) matched = true;
      }

      if (Array.isArray(value)) {
        for (let index = 0; index < Math.min(value.length, 300); index += 1) {
          walk(value[index], `${path}[${index}]`, matched, depth + 1);
        }
        return;
      }

      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key, matched, depth + 1);
        if (visited > 120000) break;
      }
    }

    for (const script of scripts) {
      const text = decodedJsonText(script);
      if (!text || (!text.startsWith("{") && !text.startsWith("["))) continue;

      try {
        walk(JSON.parse(text), script.id || "application-json", false, 0);
      } catch (_error) {
        // Some framework data scripts are not strict JSON; the live media and
        // performance-entry strategies remain available.
      }
    }
  }

  function extractTitle(video) {
    const localRoot = video?.closest('[data-e2e*="video"], [role="dialog"], article');
    const localDescription = localRoot?.querySelector(
      '[data-e2e="video-desc"], [data-e2e="browse-video-desc"], h1'
    );
    const values = [
      localDescription?.textContent,
      document.querySelector('meta[property="og:title"]')?.content,
      document.title
    ];

    return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
  }

  function extractBestCandidate() {
    candidates.clear();
    const video = findCurrentVideo();
    const pageVideoId = getCurrentVideoId();
    const capturedItem = capturedById.get(pageVideoId);
    if (capturedItem) addCandidate(capturedItem.url, "captured:play_addr", 1000);
    collectFromVideoElement(video);

    // Page-wide resource/history data can contain the previous or preloaded
    // next item. Only use those fallbacks when the URL identifies this work.
    if (pageVideoId) {
      collectFromMetadata();
      collectFromJsonScripts();
    }

    const best = Array.from(candidates.values()).sort((a, b) => b.score - a.score)[0];
    return best
      ? {
          ...best,
          title: capturedItem?.title || extractTitle(video),
          videoId: pageVideoId
        }
      : null;
  }

  function sendDownload(candidate) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "DOUYIN_DOWNLOAD_VIDEO",
          url: candidate.url,
          context: candidate.context,
          title: candidate.title,
          videoId: candidate.videoId
        },
        (response) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        }
      );
    });
  }

  async function subtitleSnapshot(resolveMedia, readNative = true) {
    let video = findCurrentVideo();
    const requestedId = getCurrentVideoId(video);
    if (!video || !requestedId) return null;
    if (!capturedById.has(requestedId) && (subtitleCaptureId !== requestedId || Date.now() - subtitleCaptureAt > 2000)) {
      subtitleCaptureId = requestedId;
      subtitleCaptureAt = Date.now();
      captureBridge?.request(requestedId);
    }
    let subtitleChecks = [];
    const hasDirectCaptions = Array.from(video.textTracks || []).some((track) => ["subtitles", "captions"].includes(track.kind) && track.cues?.length) || Array.from(video.querySelectorAll('track[kind="subtitles"], track[kind="captions"]')).some((track) => globalThis.DouyinSubtitleCore.trustedUrl(track.src));
    if (resolveMedia && readNative && !hasDirectCaptions && captureBridge?.requestSubtitles) {
      const response = await captureBridge.requestSubtitles(requestedId);
      subtitleChecks = response.checks || [];
      if (response.item) acceptCapturedItem(response.item);
      if (getCurrentVideoId() !== requestedId) return null;
    } else if (resolveMedia && !readNative) {
      captureBridge?.request(requestedId);
      for (let attempt = 0; attempt < 12 && !capturedById.has(requestedId); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        if (getCurrentVideoId() !== requestedId) return null;
      }
    }
    video = findCurrentVideo();
    if (!video || getCurrentVideoId(video) !== requestedId) return null;
    const captured = capturedById.get(requestedId);
    const snapshot = {
      videoId: requestedId,
      title: captured?.title || extractTitle(video),
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0
    };
    if (!resolveMedia) return snapshot;

    // Only use the selected video's source, never page-wide metadata from an older slide.
    const direct = core.normalizeCandidateUrl(video.currentSrc || video.src);
    snapshot.url = captured?.url || (
      direct && core.isAllowedMediaHost(direct) && core.isLikelyMediaUrl(direct, "videoElement:currentSrc")
        ? direct : null
    );
    snapshot.subtitleTracks = captured?.subtitleTracks || [];
    snapshot.nativeSegments = globalThis.DouyinSubtitleCore.normalizeSegments(captured?.nativeSegments, snapshot.duration);
    snapshot.subtitleChecks = subtitleChecks;
    try {
      // Explicit HTML tracks still work when their TextTrack cues haven't been
      // activated by the player. Fetching the file doesn't change player prefs.
      const trackUrls = new Set(snapshot.subtitleTracks.map((track) => track.url));
      for (const track of video.querySelectorAll('track[kind="subtitles"], track[kind="captions"]')) {
        const url = globalThis.DouyinSubtitleCore.trustedUrl(track.src);
        if (url && !trackUrls.has(url)) {
          trackUrls.add(url);
          snapshot.subtitleTracks = [...snapshot.subtitleTracks, { url, language: track.srclang || "" }].slice(0, 12);
        }
      }
      for (const track of Array.from(video.textTracks || [])) {
        if (!["subtitles", "captions"].includes(track.kind) || !track.cues?.length) continue;
        const segments = globalThis.DouyinSubtitleCore.normalizeSegments(
          Array.from(track.cues).slice(0, 6000).map((cue) => ({ start: cue.startTime, end: cue.endTime, text: cue.text })),
          snapshot.duration
        );
        if (segments.length > snapshot.nativeSegments.length) snapshot.nativeSegments = segments;
      }
    } catch (_) { /* Some players do not expose TextTrack cues. */ }
    return snapshot;
  }

  async function onDownloadClick() {
    if (busy) return;
    busy = true;
    setButton("正在获取…", "idle", true);
    showDetail("");

    try {
      const requestedId = getCurrentVideoId();
      captureBridge?.request(requestedId);
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      let candidate = extractBestCandidate();

      if (!candidate) {
        for (let attempt = 0; attempt < 10 && !capturedById.has(requestedId); attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
        candidate = extractBestCandidate();
      }

      if (!candidate) {
        throw new Error("未捕获当前视频，请刷新页面并播放几秒后重试。");
      }

      const response = await sendDownload(candidate);
      if (!response?.ok) {
        throw new Error(response?.error || "浏览器没有启动下载。");
      }

      button.title = `已交给浏览器下载：${response.filename}`;
      lastDownloadId = response.downloadId;
      setButton("✓ 已开始下载", "success", true);
      restoreButton(1800);
    } catch (error) {
      button.title = error?.message || "下载失败";
      setButton("下载失败", "error", true);
      showDetail(error?.message || "未知错误");
      restoreButton(5500);
    }
  }

  function updateVisibility() {
    if (!host.isConnected) {
      (document.documentElement || document.body).appendChild(host);
    }
    const hasVisibleVideo = Array.from(document.querySelectorAll("video")).some(
      (video) => elementVisibleArea(video).area > 0
    );
    host.style.display = hasVisibleVideo ? "block" : "none";
  }

  function scheduleVisibilityUpdate() {
    window.clearTimeout(visibilityTimer);
    visibilityTimer = window.setTimeout(updateVisibility, 250);
  }

  button.addEventListener("click", onDownloadClick);
  subtitleButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "DOUYIN_OPEN_SUBTITLES" }, (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) showDetail("请点击浏览器工具栏中的本插件图标，打开口播字幕。" + (error?.message || response?.error || ""));
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id === chrome.runtime.id && !sender.tab && message?.type === "DOUYIN_SUBTITLE_SNAPSHOT") {
      subtitleSnapshot(Boolean(message.resolveMedia), message.readNative !== false).then(
        (snapshot) => sendResponse({ ok: true, snapshot }),
        (error) => sendResponse({ ok: false, error: error.message })
      );
      return true;
    }
    if (sender.id === chrome.runtime.id && !sender.tab && message?.type === "DOUYIN_SUBTITLE_SEEK") {
      const video = findCurrentVideo();
      const time = Number(message.time);
      if (video && getCurrentVideoId(video) === message.videoId && Number.isFinite(time) && time >= 0) {
        video.currentTime = Math.min(time, Number.isFinite(video.duration) ? video.duration : time);
        sendResponse({ ok: true });
      } else sendResponse({ ok: false, error: "当前视频已切换" });
      return false;
    }
    if (message?.type !== "DOUYIN_DOWNLOAD_STATUS" || message.downloadId !== lastDownloadId) return;

    if (message.state === "complete") {
      button.title = "浏览器已完成下载";
      setButton("✓ 下载完成", "success", true);
      restoreButton(1800);
    } else if (message.state === "interrupted") {
      button.title = `下载中断：${message.error || "未知原因"}`;
      setButton("下载失败", "error", true);
      showDetail(`下载中断：${message.error || "未知原因"}`);
      restoreButton(5500);
    }
  });
  new MutationObserver(scheduleVisibilityUpdate).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "class", "style"]
  });
  window.addEventListener("popstate", scheduleVisibilityUpdate, { passive: true });
  window.addEventListener("resize", scheduleVisibilityUpdate, { passive: true });
  updateVisibility();
})();
