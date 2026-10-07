"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const captureCore = require("../capture-core.js");

const messageListeners = [];
const postedMessages = [];
const awemeId = "7674035171997330170";
const reactNode = { parentElement: null };
reactNode.__reactProps$test = {
  children: {
    props: {
      item: {
        awemeId,
        desc: "精选页视频",
        video: {
          playAddr: [
            { src: "https://v95-sz-web-prime.douyinvod.com/video/tos/cn/example/full-video/" }
          ]
        }
      }
    }
  }
};

const context = {
  DouyinCaptureCore: captureCore,
  TextDecoder,
  URL,
  clearInterval() {},
  console,
  document: {
    querySelector(selector) {
      return selector === `.video_${awemeId}` ? reactNode : null;
    },
    querySelectorAll() {
      return [];
    }
  },
  fetch: undefined,
  location: {
    href: `https://www.douyin.com/jingxuan?modal_id=${awemeId}`,
    origin: "https://www.douyin.com"
  },
  performance: {
    getEntriesByType() {
      return [];
    }
  },
  setInterval() {
    return 1;
  },
  setTimeout() {
    return 1;
  },
  XMLHttpRequest: undefined
};
context.window = context;
context.globalThis = context;
context.addEventListener = (type, listener) => {
  if (type === "message") messageListeners.push(listener);
};
context.postMessage = (message) => postedMessages.push(message);

vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve("../page-hook.js"), "utf8"), context);
assert.equal(messageListeners.length, 1);

messageListeners[0]({
  source: vm.runInContext("window", context),
  origin: context.location.origin,
  data: {
    channel: "__DOUYIN_SIMPLE_DOWNLOADER_V1__",
    kind: "request",
    awemeId
  }
});

assert.equal(postedMessages.length, 1);
assert.equal(postedMessages[0].kind, "captured");
assert.equal(postedMessages[0].item.awemeId, awemeId);
assert.equal(
  postedMessages[0].item.url,
  "https://v95-sz-web-prime.douyinvod.com/video/tos/cn/example/full-video/"
);

console.log("page-hook.test.js: passed");
