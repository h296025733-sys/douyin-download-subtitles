"use strict";

importScripts("core.js");

const core = globalThis.DouyinDownloadCore;
const activeDownloads = new Map();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "DOUYIN_OPEN_SUBTITLES") return false;
  if (!core.isDouyinPage(sender.tab?.url || "") || sender.frameId !== 0) return false;
  // Call open immediately in the click message so Chrome retains the user gesture.
  chrome.sidePanel.open({ tabId: sender.tab.id }).then(
    () => sendResponse({ ok: true }),
    (error) => sendResponse({ ok: false, error: error.message })
  );
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "DOUYIN_DOWNLOAD_VIDEO") {
    return false;
  }

  const sourcePage = sender.tab?.url || "";
  if (!core.isDouyinPage(sourcePage)) {
    sendResponse({ ok: false, error: "请求不是来自抖音网页。" });
    return false;
  }

  const url = core.normalizeCandidateUrl(message.url);
  if (
    !url ||
    core.isUnsupportedStream(url) ||
    !core.isLikelyMediaUrl(url, message.context) ||
    !core.isAllowedMediaHost(url)
  ) {
    sendResponse({ ok: false, error: "当前视频流格式暂不支持直接下载。" });
    return false;
  }

  if (core.isKnownWatermarked(url, message.context)) {
    sendResponse({ ok: false, error: "只找到了带水印地址，请播放几秒后重试。" });
    return false;
  }

  const filename = core.sanitizeFilename(message.title, message.videoId);

  chrome.downloads.download(
    {
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    },
    (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error || typeof downloadId !== "number") {
        sendResponse({
          ok: false,
          error: `浏览器下载启动失败：${error?.message || "未知原因"}`
        });
        return;
      }

      activeDownloads.set(downloadId, sender.tab.id);
      sendResponse({ ok: true, downloadId, filename });
    }
  );

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  const tabId = activeDownloads.get(delta.id);
  if (typeof tabId !== "number") return;

  let state = "";
  let error = "";
  if (delta.state?.current === "complete") state = "complete";
  if (delta.state?.current === "interrupted" || delta.error?.current) {
    state = "interrupted";
    error = delta.error?.current || "下载被中断";
  }
  if (!state) return;

  activeDownloads.delete(delta.id);
  chrome.tabs.sendMessage(
    tabId,
    { type: "DOUYIN_DOWNLOAD_STATUS", downloadId: delta.id, state, error },
    () => void chrome.runtime.lastError
  );
});
