"use strict";

const assert = require("node:assert/strict");
const capture = require("../capture-core.js");

const payload = {
  status_code: 0,
  aweme_detail: {
    aweme_id: "7674228174758137107",
    desc: "测试视频标题",
    video: {
      play_addr: {
        url_list: [
          "https://v3-web.douyinvod.com/video/tos/example.mp4?token=ok",
          "https://v5.douyin.com/aweme/v1/playwm/?watermark=1"
        ]
      },
      download_addr: {
        url_list: ["https://v5.douyin.com/download.mp4?watermark=1"]
      }
    }
  }
};

const items = capture.extractPlayableItems(JSON.stringify(payload));
assert.equal(items.length, 1);
assert.deepEqual(items[0], {
  awemeId: "7674228174758137107",
  title: "测试视频标题",
  url: "https://v3-web.douyinvod.com/video/tos/example.mp4?token=ok"
});
assert.equal(capture.normalizePlayUrl("https://example.com/a.m3u8"), null);
assert.equal(capture.normalizePlayUrl("https://example.com/play/dash/media-video-avc1/a.mp4"), null);
assert.deepEqual(capture.extractPlayableItems("<html>not json</html>"), []);

const reactItem = {
  awemeId: "7674035171997330170",
  desc: "精选页视频",
  video: {
    playAddr: [
      { src: "https://v95-sz-web-prime.douyinvod.com/video/tos/cn/example/full-video/" },
      { src: "https://v26-web-prime.douyinvod.com/video/tos/cn/example/full-video/" }
    ]
  }
};
assert.deepEqual(capture.extractPlayableItems({ children: { props: { item: reactItem } } }), [
  {
    awemeId: "7674035171997330170",
    title: "精选页视频",
    url: "https://v95-sz-web-prime.douyinvod.com/video/tos/cn/example/full-video/"
  }
]);

console.log("capture-core.test.js: passed");
