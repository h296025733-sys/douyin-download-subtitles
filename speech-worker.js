import { env, pipeline } from "./assets/transformers.web.js";

// Inference lives in a dedicated worker, so switching a video can stop it immediately.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("./assets/onnx/", self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let transcriberPromise = null;

self.onmessage = async ({ data }) => {
  const { id, samples } = data;
  const send = (type, payload) => self.postMessage({ id, type, ...payload });
  try {
    if (!(samples instanceof Float32Array) || !samples.length) throw new Error("没有可识别的音频");
    const files = new Map();
    if (!transcriberPromise) {
      send("progress", { message: "正在加载语音模型；首次使用需下载约 90 MB…", percent: null });
      transcriberPromise = pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
        device: "wasm", dtype: "q8",
        progress_callback(event) {
          if (event?.status !== "progress") return;
          files.set(event.file, { loaded: Number(event.loaded) || 0, total: Number(event.total) || 0 });
          let loaded = 0, total = 0;
          for (const value of files.values()) { loaded += value.loaded; total += value.total; }
          send("progress", { message: `正在下载语音模型：${(loaded / 1000000).toFixed(1)} MB`, percent: total ? Math.min(100, loaded / total * 100) : null });
        }
      }).catch((error) => { transcriberPromise = null; throw error; });
    }
    const transcriber = await transcriberPromise;
    send("progress", { message: "正在本机识别口播，请稍候…", percent: null });
    const result = await transcriber(samples, {
      return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
      language: "chinese", task: "transcribe"
    });
    const output = Array.isArray(result) ? result[0] : result;
    send("result", { output });
  } catch (error) {
    send("error", { error: String(error?.message || error).slice(0, 800) });
  }
};
