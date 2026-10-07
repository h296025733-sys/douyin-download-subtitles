(function installDouyinNetworkCapture() {
  "use strict";

  const captureCore = globalThis.DouyinCaptureCore;
  try {
    delete globalThis.DouyinCaptureCore;
  } catch (_error) {
    // Keeping the helper is harmless if the page makes the property non-configurable.
  }
  if (!captureCore) return;

  const CHANNEL = "__DOUYIN_SIMPLE_DOWNLOADER_V1__";
  const subtitles = globalThis.DouyinSubtitleCore;
  const captured = new Map();
  const trackOwners = new Map();
  const subtitleRequests = new Map();
  const attachedRequests = new WeakSet();
  const wrappedXhrConstructors = new WeakSet();
  const wrappedFetchFunctions = new WeakSet();
  const replayingDetailIds = new Set();
  let hookTimer = 0;

  function isVideoDataRequest(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl || ""), location.href);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith("/aweme/")) return false;
      return /(?:aweme\/detail|module\/feed|\/feed\/|aweme\/post|aweme\/favorite|mix\/list|collection)/i.test(
        parsed.pathname
      );
    } catch (_error) {
      return false;
    }
  }

  function publish(item) {
    item = subtitles?.mergeItems(captured.get(item.awemeId), item) || item;
    captured.set(item.awemeId, item);
    while (captured.size > 100) captured.delete(captured.keys().next().value);
    for (const track of item.subtitleTracks || []) trackOwners.set(track.url, item.awemeId);
    while (trackOwners.size > 600) trackOwners.delete(trackOwners.keys().next().value);
    window.postMessage({ channel: CHANNEL, kind: "captured", item }, location.origin);
  }

  function inspectPayload(payload) {
    try {
      const parsed = captureCore.parsePayload(payload);
      for (const item of captureCore.extractPlayableItems(parsed)) publish(item);
      for (const item of captureCore.extractSubtitleItems?.(parsed) || []) publish(item);
    } catch (_error) {
      // Capture is fail-open: page networking must never be affected.
    }
  }

  function subtitleOwner(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      url.hash = "";
      if (trackOwners.has(url.href)) return trackOwners.get(url.href);
      if (url.origin !== location.origin || !url.pathname.startsWith("/aweme/") || !/caption|subtitle/i.test(url.pathname)) return "";
      const id = url.searchParams.get("aweme_id") || url.searchParams.get("item_id");
      return /^\d{8,30}$/.test(id || "") ? id : "";
    } catch (_) { return ""; }
  }

  function inspectResponse(text, rawUrl) {
    inspectPayload(text);
    const awemeId = subtitleOwner(rawUrl);
    if (!awemeId || !subtitles) return;
    const nativeSegments = subtitles.parseSubtitleFile(text);
    if (nativeSegments.length) publish({ awemeId, title: "", url: "", nativeSegments });
    // A subtitle endpoint may wrap its track information without repeating the
    // item id in its body. Only the explicit id in that observed URL binds it.
    const data = captureCore.parsePayload(text);
    if (data) {
      for (const owner of [data, data.data]) {
        if (owner && typeof owner === "object") inspectPayload({ ...owner, aweme_id: awemeId });
      }
    }
  }

  async function fetchText(url, timeout = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await window.fetch(url, { credentials: "include", signal: controller.signal });
      if (!response.ok) return { state: `HTTP ${response.status}`, text: "" };
      const text = await response.text();
      return { state: text ? "已返回" : "空响应", text: text.length <= 30000000 ? text : "" };
    } catch (error) {
      return { state: error.name === "AbortError" ? "超时" : "请求失败", text: "" };
    } finally { clearTimeout(timer); }
  }

  async function replayObservedDetailRequest(awemeId) {
    if (replayingDetailIds.has(awemeId)) return "请求中";

    let observedUrl = "";
    try {
      const entries = performance.getEntriesByType("resource");
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const parsed = new URL(entries[index].name, location.href);
        if (
          parsed.origin === location.origin &&
          parsed.pathname.includes("/aweme/v1/web/aweme/detail/") &&
          parsed.searchParams.get("aweme_id") === awemeId
        ) {
          observedUrl = parsed.href;
          break;
        }
      }
    } catch (_error) {
      return "无法读取已观察请求";
    }
    if (!observedUrl) return "没有匹配的已观察请求";

    replayingDetailIds.add(awemeId);
    try {
      const response = await fetchText(observedUrl);
      inspectResponse(response.text, observedUrl);
      return response.state;
    } catch (_error) {
      return "请求失败";
    } finally {
      replayingDetailIds.delete(awemeId);
    }
  }

  async function inspectXhr(xhr) {
    try {
      if (!isVideoDataRequest(xhr.responseURL) && !subtitleOwner(xhr.responseURL)) return;
      const responseType = String(xhr.responseType || "").toLowerCase();
      if (responseType === "json") {
        inspectResponse(JSON.stringify(xhr.response), xhr.responseURL);
      } else if (responseType === "arraybuffer" && xhr.response) {
        inspectResponse(new TextDecoder().decode(xhr.response), xhr.responseURL);
      } else if (responseType === "blob" && xhr.response?.text) {
        inspectResponse(await xhr.response.text(), xhr.responseURL);
      } else {
        inspectResponse(typeof xhr.response === "string" ? xhr.response : xhr.responseText, xhr.responseURL);
      }
    } catch (_error) {
      // Reading a mismatched XHR responseType can throw; leave the page untouched.
    }
  }

  function attachToXhr(xhr) {
    if (!xhr || attachedRequests.has(xhr)) return;
    attachedRequests.add(xhr);
    try {
      xhr.addEventListener("loadend", () => void inspectXhr(xhr), { once: true });
    } catch (_error) {
      // A nonstandard XHR-like object is ignored.
    }
  }

  function hookXhrConstructor() {
    try {
      const CurrentXhr = window.XMLHttpRequest;
      if (typeof CurrentXhr !== "function" || wrappedXhrConstructors.has(CurrentXhr)) return;

      let ProxyXhr;
      ProxyXhr = new Proxy(CurrentXhr, {
        construct(Target, args, NewTarget) {
          const effectiveNewTarget = NewTarget === ProxyXhr ? Target : NewTarget;
          const xhr = Reflect.construct(Target, args, effectiveNewTarget);
          attachToXhr(xhr);
          return xhr;
        }
      });
      wrappedXhrConstructors.add(ProxyXhr);
      window.XMLHttpRequest = ProxyXhr;
    } catch (_error) {
      // The site may temporarily lock the constructor; the poller will retry.
    }
  }

  function hookFetch() {
    try {
      const CurrentFetch = window.fetch;
      if (typeof CurrentFetch !== "function" || wrappedFetchFunctions.has(CurrentFetch)) return;

      function wrappedFetch(...args) {
        const result = Reflect.apply(CurrentFetch, this, args);
        Promise.resolve(result)
          .then((response) => {
            try {
              const requestUrl = response?.url || args[0]?.url || args[0];
              if (isVideoDataRequest(requestUrl) || subtitleOwner(requestUrl)) {
                response.clone().text().then((text) => inspectResponse(text, requestUrl)).catch(() => {});
              }
            } catch (_error) {
              // Cloning/reading a consumed response can fail without affecting it.
            }
          })
          .catch(() => {});
        return result;
      }

      wrappedFetchFunctions.add(wrappedFetch);
      window.fetch = wrappedFetch;
    } catch (_error) {
      // Keep the page's original fetch behavior on any hook failure.
    }
  }

  function collectReact(requestedId) {
    // Feed-style pages keep the active item in React props even when the URL
    // and static RENDER_DATA no longer describe the newly selected slide.
    let foundInReact = false;
    try {
      const roots = [];
      const preferred = document.querySelector(`.video_${requestedId}`);
      let node = preferred;
      if (!node) {
        const videos = Array.from(document.querySelectorAll("video"));
        node = videos.find((video) => !video.paused && video.getBoundingClientRect().height > 100) || null;
      }

      for (let depth = 0; node && depth < 14; depth += 1, node = node.parentElement) {
        for (const key of Object.keys(node)) {
          if (key.startsWith("__reactProps$")) roots.push(node[key]);
          if (key.startsWith("__reactFiber$")) {
            let fiber = node[key];
            for (let level = 0; fiber && level < 16; level += 1, fiber = fiber.return) {
              roots.push(fiber.memoizedProps, fiber.pendingProps);
            }
          }
        }
      }

      const seenRoots = new WeakSet();
      for (const root of roots.slice(0, 80)) {
        if (!root || typeof root !== "object" || seenRoots.has(root)) continue;
        seenRoots.add(root);
        const items = [...captureCore.extractPlayableItems(root), ...(captureCore.extractSubtitleItems?.(root) || [])];
        for (const item of items) {
          if (item.awemeId !== requestedId) continue;
          publish(item);
          foundInReact = true;
        }
        if (hasSubtitles(requestedId)) break;
      }
    } catch (_error) {
      // React internals are only a fallback; failure must not affect the page.
    }
    return foundInReact;
  }

  function collectScripts(doc, requestedId) {
    for (const script of Array.from(doc.querySelectorAll('script[type="application/json"], script#RENDER_DATA, script#__NEXT_DATA__, script#__UNIVERSAL_DATA_FOR_REHYDRATION__')).slice(0, 24)) {
      const parsed = captureCore.parsePayload(script.textContent);
      const items = [...captureCore.extractPlayableItems(parsed), ...(captureCore.extractSubtitleItems?.(parsed) || [])];
      for (const item of items) if (item.awemeId === requestedId) publish(item);
    }
  }

  function collectPage(requestedId) {
    collectReact(requestedId);
    try {
      collectScripts(document, requestedId);
      for (const payload of [window._ROUTER_DATA, window.__NEXT_DATA__, window.RENDER_DATA]) {
        const items = [...captureCore.extractPlayableItems(payload), ...(captureCore.extractSubtitleItems?.(payload) || [])];
        for (const item of items) if (item.awemeId === requestedId) publish(item);
      }
    } catch (_) { /* Optional hydration sources must not break the host page. */ }
  }

  function hasSubtitles(id) {
    const item = captured.get(id);
    return Boolean(item?.subtitleTracks?.length || item?.nativeSegments?.length);
  }

  async function resolveSubtitles(awemeId) {
    const checks = [];
    collectPage(awemeId);
    checks.push(`页面数据：${hasSubtitles(awemeId) ? "有字幕" : "未发现字幕"}`);
    if (!hasSubtitles(awemeId)) {
      checks.push(`详情请求：${await replayObservedDetailRequest(awemeId)}`);
      collectPage(awemeId);
    }
    if (!hasSubtitles(awemeId)) {
      // Same-origin ordinary page read, not an unsigned/private API or a
      // signature/challenge bypass. Never execute scripts from this response.
      const response = await fetchText(`${location.origin}/video/${awemeId}`);
      if (response.text && typeof DOMParser === "function") {
        const doc = new DOMParser().parseFromString(response.text, "text/html");
        collectScripts(doc, awemeId);
      }
      checks.push(`视频详情页：${response.state}`);
    }
    return { item: captured.get(awemeId) || null, checks };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.channel !== CHANNEL) return;
    const requestedId = String(message.awemeId || "");
    if (!/^\d{8,30}$/.test(requestedId)) return;
    if (message.kind === "subtitle-request" && typeof message.requestId === "string" && message.requestId.length <= 80) {
      if (!subtitleRequests.has(requestedId)) {
        if (subtitleRequests.size >= 4) return;
        subtitleRequests.set(requestedId, resolveSubtitles(requestedId).finally(() => subtitleRequests.delete(requestedId)));
      }
      void subtitleRequests.get(requestedId).then((result) => {
        window.postMessage({ channel: CHANNEL, kind: "subtitle-result", awemeId: requestedId, requestId: message.requestId, ...result }, location.origin);
      }).catch(() => {
        window.postMessage({ channel: CHANNEL, kind: "subtitle-result", awemeId: requestedId, requestId: message.requestId, checks: ["页面字幕读取异常"] }, location.origin);
      });
      return;
    }
    if (message.kind !== "request") return;
    if (captured.has(requestedId)) publish(captured.get(requestedId));
    const foundInReact = collectReact(requestedId);
    if (!foundInReact && !captured.has(requestedId)) void replayObservedDetailRequest(requestedId);
  });

  hookXhrConstructor();
  hookFetch();
  hookTimer = window.setInterval(() => {
    hookXhrConstructor();
    hookFetch();
  }, 25);
  window.setTimeout(() => {
    if (hookTimer) clearInterval(hookTimer);
    hookTimer = 0;
  }, 30000);
})();
