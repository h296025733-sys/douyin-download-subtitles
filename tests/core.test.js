"use strict";

const assert = require("node:assert/strict");
const core = require("../core.js");

assert.equal(
  core.normalizeCandidateUrl("https:\\/\\/v3-web.douyinvod.com\\/video\\/test.mp4"),
  "https://v3-web.douyinvod.com/video/test.mp4"
);
assert.equal(core.normalizeCandidateUrl("blob:https://www.douyin.com/123"), null);
assert.equal(core.normalizeCandidateUrl("javascript:alert(1)"), null);
assert.equal(core.normalizeCandidateUrl("这只是标题", "https://www.douyin.com/video/12345678"), null);
assert.equal(core.isUnsupportedStream("https://example.com/a.m3u8?x=1"), true);
assert.equal(core.isUnsupportedStream("https://example.com/chunk-001.m4s"), true);
assert.equal(core.isUnsupportedStream("https://example.com/init.mp4?range=0-999"), true);
assert.equal(core.isUnsupportedStream("https://example.com/a.mp4?x=1"), false);
assert.equal(
  core.makeLegacyCleanUrl("https://www.douyin.com/aweme/v1/playwm/?video_id=1&watermark=1"),
  "https://www.douyin.com/aweme/v1/play/?video_id=1&watermark=0"
);
assert.ok(
  core.scoreMediaUrl("https://v3-web.douyinvod.com/video/tos/a.mp4", "videoElement:currentSrc") >
    core.scoreMediaUrl("https://v3-web.douyinvod.com/audio/tos/a.mp4", "performance:resource")
);
assert.equal(core.getVideoId("https://www.douyin.com/video/7117200114686414094"), "7117200114686414094");
assert.equal(core.getVideoId("https://www.douyin.com/?modal_id=12345678"), "12345678");
assert.equal(core.isDouyinPage("https://www.douyin.com/video/1"), true);
assert.equal(core.isDouyinPage("https://evil.example/?douyin.com"), false);
assert.equal(core.isLikelyMediaUrl("https://www.douyin.com/video/7117200114686414094", "json:video"), false);
assert.equal(core.isLikelyMediaUrl("https://v3-web.douyinvod.com/opaque-token", "videoElement:currentSrc"), true);
assert.equal(core.isAllowedMediaHost("https://v3-web.douyinvod.com/opaque-token"), true);
assert.equal(core.isAllowedMediaHost("https://evil.example/video.mp4"), false);
assert.equal(core.isLikelyMediaUrl("https://v3-web.douyinvod.com/media-video-avc1/a.mp4", "performance:video"), false);
assert.equal(core.sanitizeFilename('  CON<>:"/\\|?*  ', "12345678"), "_CON.mp4");
assert.equal(core.sanitizeFilename("标题 - 抖音", ""), "标题.mp4");
assert.match(core.sanitizeFilename("...", "12345678"), /^抖音视频_12345678\.mp4$/);
assert.ok(core.sanitizeFilename("很长".repeat(100), "").length <= 204);

console.log("core.test.js: passed");
