"use strict";

const fs = require("node:fs");
const path = require("node:path");

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }

      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params || {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Runtime.evaluate failed"
    );
  }
  return result.result.value;
}

async function waitFor(check, timeoutMs, intervalMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function main() {
  const port = Number(process.argv[2] || 9333);
  const mode = process.argv[3] || "inspect";
  const outputDir = path.resolve(process.argv[4] || path.join(__dirname, "live-output"));
  fs.mkdirSync(outputDir, { recursive: true });

  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const pageTarget = targets.find((target) => target.type === "page" && /https:\/\/[^/]*douyin\.com\//.test(target.url));
  if (!pageTarget) throw new Error("No Douyin page target found");

  const browser = new CdpClient(version.webSocketDebuggerUrl);
  const page = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await Promise.all([browser.connect(), page.connect()]);
  await Promise.all([page.send("Runtime.enable"), page.send("Page.enable")]);

  const diagnostics = await waitFor(
    () => evaluate(
      page,
      `(() => {
        const host = document.getElementById("douyin-simple-downloader-host");
        const videos = Array.from(document.querySelectorAll("video")).map((video) => {
          const rect = video.getBoundingClientRect();
          return {
            src: video.currentSrc || video.src || "",
            paused: video.paused,
            readyState: video.readyState,
            duration: Number.isFinite(video.duration) ? video.duration : null,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        });
        const resources = performance.getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => /douyinvod|zjcdn|bytecdn|[.]mp4|video[/]tos/i.test(url))
          .slice(-10);
        const rect = host?.getBoundingClientRect();
        return {
          url: location.href,
          title: document.title,
          readyState: document.readyState,
          host: host ? {
            display: getComputedStyle(host).display,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          } : null,
          videos,
          resources,
          jsonScriptIds: Array.from(document.querySelectorAll('script[type="application/json"], script[id]'))
            .map((script) => script.id)
            .filter(Boolean)
            .slice(0, 30),
          captchaFrames: Array.from(document.querySelectorAll("iframe"))
            .map((frame) => frame.src)
            .filter((url) => /captcha|verify|nocaptcha/i.test(url))
        };
      })()`
    ),
    15000
  );

  const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
  const screenshotPath = path.join(outputDir, "douyin-page.png");
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ browser: version.Browser, diagnostics, screenshotPath }, null, 2));

  if (mode !== "click") {
    browser.close();
    page.close();
    return;
  }

  if (!diagnostics?.host || diagnostics.host.display === "none" || diagnostics.host.rect.width <= 0) {
    throw new Error("Downloader button is not visible; live click test cannot continue");
  }

  await browser.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: outputDir,
    eventsEnabled: true
  });

  let downloadResult = null;
  browser.on("Browser.downloadProgress", (event) => {
    if (event.state === "completed" || event.state === "canceled") {
      downloadResult = event;
    }
  });

  const x = diagnostics.host.rect.x + diagnostics.host.rect.width / 2;
  const y = diagnostics.host.rect.y + diagnostics.host.rect.height / 2;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });

  const finalDownload = await waitFor(() => downloadResult, 45000, 250);
  const files = fs.readdirSync(outputDir).filter((name) => name !== "douyin-page.png").map((name) => {
    const filePath = path.join(outputDir, name);
    return { name, bytes: fs.statSync(filePath).size };
  });
  console.log(JSON.stringify({ finalDownload, files }, null, 2));

  if (!finalDownload || finalDownload.state !== "completed" || !files.some((file) => file.bytes > 0 && !file.name.endsWith(".crdownload"))) {
    throw new Error("No completed non-empty download observed");
  }

  browser.close();
  page.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
