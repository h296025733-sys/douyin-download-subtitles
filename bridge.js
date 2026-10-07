(function installDouyinCaptureBridge() {
  "use strict";

  const CHANNEL = "__DOUYIN_SIMPLE_DOWNLOADER_V1__";
  const queue = [];
  const listeners = new Set();
  const pending = new Map();
  let nextRequest = 0;

  const bridge = Object.freeze({
    queue,
    subscribe(listener) {
      if (typeof listener === "function") listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request(awemeId) {
      window.postMessage(
        { channel: CHANNEL, kind: "request", awemeId: String(awemeId || "") },
        location.origin
      );
    },
    requestSubtitles(awemeId) {
      const id = String(awemeId || "");
      if (!/^\d{8,30}$/.test(id)) return Promise.resolve({ checks: ["视频 ID 无效"] });
      if (pending.size >= 4) return Promise.resolve({ checks: ["字幕请求正在处理中"] });
      const requestId = `${Date.now()}-${++nextRequest}`;
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          pending.delete(requestId);
          resolve({ checks: ["页面字幕响应超时"] });
        }, 10000);
        pending.set(requestId, { awemeId: id, resolve, timer });
        window.postMessage({ channel: CHANNEL, kind: "subtitle-request", awemeId: id, requestId }, location.origin);
      });
    }
  });

  Object.defineProperty(globalThis, "__DouyinSimpleDownloadBridge", {
    value: bridge,
    configurable: false,
    enumerable: false,
    writable: false
  });

  function safeItem(item) {
    if (
      !item ||
      !/^\d{8,30}$/.test(String(item.awemeId || "")) ||
      (item.url != null && (typeof item.url !== "string" || item.url.length > 12000)) ||
      typeof item.title !== "string" ||
      item.title.length > 1000
    ) {
      return null;
    }
    let textSize = 0;
    const nativeSegments = (Array.isArray(item.nativeSegments) ? item.nativeSegments : []).slice(0, 6000).flatMap((row) => {
      if (typeof row?.text !== "string" || !Number.isFinite(row.start) || !Number.isFinite(row.end)) return [];
      textSize += row.text.length;
      if (textSize > 1000000) return [];
      return [{ start: row.start, end: row.end, text: row.text.slice(0, 6000) }];
    });
    return Object.freeze({
      awemeId: String(item.awemeId),
      title: item.title,
      url: item.url || "",
      subtitleTracks: Array.isArray(item.subtitleTracks) ? item.subtitleTracks.slice(0, 12).flatMap((track) =>
        typeof track?.url === "string" && track.url.length <= 12000
          ? [{ url: track.url, language: String(track.language || "").slice(0, 40), format: String(track.format || "").slice(0, 30), original: track.original === true }] : []
      ) : [],
      nativeSegments
    });
  }

  function deliver(item) {
    queue.push(item);
    if (queue.length > 20) queue.shift();

    for (const listener of listeners) {
      try {
        listener(item);
      } catch (_error) {
        // One listener must not stop later captured responses from being used.
      }
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.channel !== CHANNEL) return;
    if (message.kind === "captured") {
      const item = safeItem(message.item);
      if (item) deliver(item);
    } else if (message.kind === "subtitle-result") {
      const request = pending.get(message.requestId);
      if (!request || request.awemeId !== String(message.awemeId)) return;
      const item = safeItem(message.item);
      if (item && item.awemeId !== request.awemeId) return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (item) deliver(item);
      request.resolve({ item, checks: (Array.isArray(message.checks) ? message.checks : []).slice(0, 8).map((entry) => String(entry).slice(0, 180)) });
    }
  });
})();
