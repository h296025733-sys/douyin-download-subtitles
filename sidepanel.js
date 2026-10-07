import { SpeechEngine, decodeAudio } from "./speech-engine.js";

const core = globalThis.DouyinDownloadCore;
const subtitles = globalThis.DouyinSubtitleCore;
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(["auto", "generate", "speech", "cancel", "status", "progress", "video-title", "summary", "download", "empty", "cues"].map((id) => [id, $(id)]));
const engine = new SpeechEngine();
const cache = new Map();
let current = null, currentKey = "", result = null, active = null;
let autoTimer = 0, attemptedKey = "", autoRetries = 0, pollPromise = null, windowId = null;
let saving = false;
let fallbackKey = "";

function status(message, state = "idle", percent) {
  ui.status.textContent = message;
  ui.status.dataset.state = state;
  ui.progress.hidden = state !== "working";
  if (Number.isFinite(percent)) ui.progress.value = percent;
  else ui.progress.removeAttribute("value");
}

function buttons() {
  ui.generate.disabled = !current || Boolean(active);
  ui.generate.textContent = active ? "正在处理…" : result ? "重新读取现成字幕" : "读取当前视频字幕";
  ui.speech.hidden = !current || fallbackKey !== currentKey;
  ui.speech.disabled = Boolean(active);
  ui.cancel.hidden = !active;
  ui.download.disabled = !result?.segments.length || saving;
}

function cancelTask() {
  clearTimeout(autoTimer);
  autoTimer = 0;
  const previous = active;
  active = null;
  previous?.controller.abort();
  buttons();
}

function assertCurrent(task) {
  if (task.controller.signal.aborted || active !== task || currentKey !== task.key) throw new DOMException("当前视频已切换", "AbortError");
}

function render() {
  ui.cues.replaceChildren();
  ui.empty.hidden = Boolean(result?.segments.length);
  ui.summary.textContent = result ? `${result.segments.length} 句 · ${result.source === "native" ? "视频已有字幕" : "本机口播识别 · 时间仅供参考"}` : "尚未生成";
  for (const row of result?.segments || []) {
    const li = document.createElement("li");
    li.className = "cue";
    const time = document.createElement("button");
    time.className = "cue-time";
    time.type = "button";
    time.dataset.seek = String(row.start);
    time.title = "跳转到这一句";
    time.textContent = `${subtitles.timestamp(row.start)} → ${subtitles.timestamp(row.end)}`;
    const text = document.createElement("p");
    text.textContent = row.text;
    li.append(time, text);
    ui.cues.append(li);
  }
  buttons();
}

function select(snapshot, tabId) {
  const valid = snapshot && /^\d{8,30}$/.test(snapshot.videoId);
  const key = valid ? `${tabId}:${snapshot.videoId}` : "";
  current = valid ? { ...snapshot, tabId } : null;
  if (key !== currentKey) {
    currentKey = key;
    cancelTask();
    attemptedKey = "";
    fallbackKey = "";
    autoRetries = 0;
    result = current ? cache.get(current.videoId) || null : null;
    render();
    status(result ? "已恢复这条视频的字幕，可直接下载。" : current ? "点击读取，或开启自动提取；不会自动下载模型。" : "请打开抖音，并让目标视频出现在播放器中。", result ? "success" : "idle");
  }
  ui["video-title"].textContent = current?.title || (current ? `当前视频 ${current.videoId}` : "打开抖音视频，即可提取口播。");
  ui["video-title"].dataset.videoId = current?.videoId || "";
  buttons();
  scheduleAuto();
}

function scheduleAuto(delay = 1000) {
  if (!ui.auto.checked || !current || result || active || autoTimer || attemptedKey === currentKey) return;
  const key = currentKey;
  autoTimer = setTimeout(() => {
    autoTimer = 0;
    if (key === currentKey && ui.auto.checked && !active) void generate("auto");
  }, delay);
}

function poll() {
  if (pollPromise) return pollPromise;
  if (windowId === null) return Promise.resolve();
  pollPromise = (async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (!tab || !core.isDouyinPage(tab.url || "")) { select(null, 0); return; }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "DOUYIN_SUBTITLE_SNAPSHOT" });
    if (!response?.ok) throw new Error(response?.error || "未连接到视频");
    select(response.snapshot, tab.id);
  } catch (_) {
    select(null, 0);
    status("请刷新抖音页面，确认已启用新版扩展。", "error");
  } finally { pollPromise = null; }
  })();
  return pollPromise;
}

async function fetchBytes(url, maxBytes, signal, timeout, onProgress = () => {}) {
  const trusted = subtitles.trustedUrl(url);
  if (!trusted) throw new Error("当前媒体地址不属于支持的抖音域名");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetch(trusted, { credentials: "include", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}），请播放几秒后重试`);
    if (!subtitles.trustedUrl(response.url)) throw new Error("媒体重定向到了暂不支持的域名");
    const total = Number(response.headers.get("content-length")) || 0;
    if (total > maxBytes) throw new Error("文件过大，请选择较短的视频");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("浏览器没有返回媒体内容");
    let loaded = 0;
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > maxBytes) { await reader.cancel(); throw new Error("文件过大，请选择较短的视频"); }
      chunks.push(value);
      onProgress(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } catch (error) {
    if (signal.aborted) throw new DOMException("已停止", "AbortError");
    if (timedOut) throw new Error("读取媒体超时，请检查网络后重试");
    if (error instanceof TypeError) throw new Error("浏览器无法读取音轨，请检查网络或刷新视频后重试");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

function usefulNative(segments, duration) {
  return subtitles.normalizeSegments(segments, duration);
}

async function nativeSubtitles(media, signal) {
  const direct = usefulNative(media.nativeSegments, media.duration);
  if (direct.length) return direct;
  const tracks = (media.subtitleTracks || []).filter((track) => subtitles.trustedUrl(track?.url)).slice(0, 6);
  const checks = (media.subtitleChecks || []).join("；");
  if (!tracks.length) throw Object.assign(new Error(`这次没有从网页读到字幕地址或带时间的字幕，不等于视频没有字幕。${checks ? `\n${checks}` : ""}\n未启动模型。若播放器有字幕开关，可先开启再读；也可自行选择下方本机识别。`), { code: "NATIVE_NOT_FOUND" });
  const failures = [];
  const deadline = Date.now() + 8000;
  // Preserve original-language/Chinese preference instead of taking whichever
  // translation CDN happens to return first.
  for (const track of tracks) {
    if (Date.now() >= deadline) { failures.push("其余地址尚未尝试（时间限制）"); break; }
    try {
      const bytes = await fetchBytes(track.url, 2000000, signal, Math.min(3500, deadline - Date.now()));
      const segments = usefulNative(subtitles.parseSubtitleFile(new TextDecoder().decode(bytes), media.duration), media.duration);
      if (!segments.length) throw new Error("返回内容无法解析成带时间的字幕");
      return segments;
    } catch (error) {
      if (signal.aborted || error.name === "AbortError") throw error;
      failures.push(String(error.message || error));
    }
  }
  throw Object.assign(new Error(`发现 ${tracks.length} 个字幕地址，但未读取成功：${[...new Set(failures)].join("；")}。未启动模型。`), { code: "NATIVE_READ_FAILED" });
}

async function remember(value) {
  cache.delete(value.videoId);
  cache.set(value.videoId, value);
  while (cache.size > 12) cache.delete(cache.keys().next().value);
  let chars = 0;
  const entries = [];
  for (const entry of [...cache.values()].reverse()) {
    chars += JSON.stringify(entry).length;
    if (chars > 2000000) break;
    entries.unshift(entry);
  }
  try { await chrome.storage.session.set({ douyinSubtitleCacheV2: entries }); } catch (_) { /* In-memory results and export remain usable. */ }
}

async function generate(trigger = "manual", mode = "native") {
  if (!current || active) return;
  const task = { key: currentKey, tabId: current.tabId, videoId: current.videoId, controller: new AbortController(), trigger };
  active = task;
  attemptedKey = currentKey;
  const signal = task.controller.signal;
  buttons();
  status(mode === "native" ? "正在获取当前视频和已有字幕…" : "正在获取当前视频音轨…", "working");
  try {
    const response = await chrome.tabs.sendMessage(task.tabId, { type: "DOUYIN_SUBTITLE_SNAPSHOT", resolveMedia: true, readNative: mode === "native" });
    assertCurrent(task);
    const media = response?.snapshot;
    if (!response?.ok || !media || media.videoId !== task.videoId) throw Object.assign(new Error("当前视频还在加载，请稍后重试。"), { code: "MEDIA_NOT_READY" });
    let segments = mode === "native" ? await nativeSubtitles(media, signal) : [];
    assertCurrent(task);
    let source = "native", duration = media.duration;
    if (mode === "speech") {
      if (!media.url || !core.isAllowedMediaHost(media.url) || !core.isLikelyMediaUrl(media.url, "captured:play_addr")) {
        throw Object.assign(new Error("尚未获取当前视频音轨，请播放几秒后再点生成；刚更新扩展需要刷新抖音页面。"), { code: "MEDIA_NOT_READY" });
      }
      if (media.duration > 20 * 60) throw new Error("当前版本支持 20 分钟以内的视频");
      status("已选择本机识别，正在读取视频音轨…", "working");
      const bytes = await fetchBytes(media.url, 150000000, signal, 100000, (loaded, total) => {
        if (active === task) status(`正在读取音轨：${(loaded / 1000000).toFixed(1)} MB`, "working", total ? loaded / total * 100 : undefined);
      });
      assertCurrent(task);
      status("正在提取音轨…", "working");
      const decoded = await decodeAudio(bytes, signal);
      assertCurrent(task);
      const output = await engine.transcribe(decoded.samples, signal, (event) => {
        if (active === task) status(event.message, "working", event.percent);
      });
      assertCurrent(task);
      duration = decoded.duration;
      const chunks = output?.chunks?.map((chunk) => ({ start: chunk.timestamp?.[0], end: chunk.timestamp?.[1], text: chunk.text })) || [];
      segments = subtitles.normalizeSegments(chunks, duration);
      if (!segments.length && output?.text?.trim()) segments = subtitles.normalizeSegments([{ start: 0, end: duration, text: output.text }], duration);
      source = "speech";
    }
    assertCurrent(task);
    // Recheck the active tab before publishing a long-running recognition result.
    await poll();
    assertCurrent(task);
    if (!segments.length) throw new Error("没有识别到口播内容，可以重试或切换视频。");
    result = { videoId: media.videoId, title: media.title, duration, source, segments };
    fallbackKey = "";
    void remember(result);
    render();
    status(`已${source === "native" ? "读取" : "识别"} ${segments.length} 句字幕，可点击时间跳转或下载 SRT。`, "success");
  } catch (error) {
    if (active !== task || currentKey !== task.key || signal.aborted || error.name === "AbortError") return;
    status(String(error.message || error).slice(0, 600), "error");
    if (mode === "native") fallbackKey = currentKey;
    if (trigger === "auto" && error.code === "MEDIA_NOT_READY" && autoRetries < 2) {
      autoRetries += 1;
      attemptedKey = "";
    }
  } finally {
    if (active === task) {
      active = null;
      buttons();
      scheduleAuto(1400);
    }
  }
}

ui.generate.addEventListener("click", () => void generate());
ui.speech.addEventListener("click", () => void generate("manual", "speech"));
ui.cancel.addEventListener("click", () => {
  attemptedKey = currentKey;
  cancelTask();
  status("已停止本条处理。可手动重试，或切换到下一条。", "idle");
});
ui.auto.addEventListener("change", () => {
  void chrome.storage.local.set({ douyinAutoSubtitlesV1: ui.auto.checked });
  if (!ui.auto.checked) {
    clearTimeout(autoTimer);
    autoTimer = 0;
    if (active?.trigger === "auto") { cancelTask(); status("已关闭自动提取，仍可手动读取字幕。"); }
  } else {
    attemptedKey = "";
    autoRetries = 0;
    scheduleAuto(0);
  }
});
ui.cues.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-seek]");
  if (!button || !current || !result || current.videoId !== result.videoId) return;
  try {
    const response = await chrome.tabs.sendMessage(current.tabId, { type: "DOUYIN_SUBTITLE_SEEK", videoId: result.videoId, time: Number(button.dataset.seek) });
    if (!response?.ok) status("视频已切换，请在当前视频生成字幕后再跳转。", "error");
  } catch (_) { status("未连接到播放器，请刷新抖音页面。", "error"); }
});
ui.download.addEventListener("click", async () => {
  if (!result?.segments.length || saving) return;
  const selected = result;
  const key = currentKey;
  const filename = core.sanitizeFilename(`${selected.title || "抖音口播"}_${selected.videoId}`, selected.videoId).replace(/\.mp4$/, ".srt");
  const url = URL.createObjectURL(new Blob(["\uFEFF", subtitles.toSrt(selected.segments)], { type: "application/x-subrip;charset=utf-8" }));
  saving = true;
  buttons();
  try {
    await chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
    if (currentKey === key) status("SRT 已交给浏览器下载，包含全部字幕与起止时间戳。", "success");
  } catch (error) {
    if (currentKey === key) status(`字幕下载失败：${error.message}`, "error");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    saving = false;
    buttons();
  }
});

async function initialize() {
  try {
    const settings = await chrome.storage.local.get("douyinAutoSubtitlesV1");
    ui.auto.checked = settings.douyinAutoSubtitlesV1 === true;
    const stored = await chrome.storage.session.get("douyinSubtitleCacheV2");
    for (const entry of (Array.isArray(stored.douyinSubtitleCacheV2) ? stored.douyinSubtitleCacheV2 : []).slice(-12)) {
      if (!/^\d{8,30}$/.test(entry?.videoId)) continue;
      const segments = subtitles.normalizeSegments(entry.segments, entry.duration);
      if (segments.length) cache.set(entry.videoId, { ...entry, segments });
    }
  } catch (_) { /* Optional cache/settings failures do not block manual recognition. */ }
  windowId = (await chrome.windows.getCurrent()).id;
  await poll();
  setInterval(() => void poll(), 700);
  chrome.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) void poll(); });
}

window.addEventListener("pagehide", () => { cancelTask(); engine.close(); });
void initialize().catch((error) => status(`字幕面板启动失败：${error.message}`, "error"));
