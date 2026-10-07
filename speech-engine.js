export class SpeechEngine {
  constructor() { this.worker = null; this.pending = null; this.sequence = 0; }

  transcribe(samples, signal, onProgress) {
    if (signal.aborted) return Promise.reject(new DOMException("已停止", "AbortError"));
    if (this.pending) return Promise.reject(new Error("上一条语音识别尚未结束"));
    if (!this.worker) {
      this.worker = new Worker(new URL("./speech-worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending;
        if (!pending || data.id !== pending.id) return;
        if (data.type === "progress") pending.onProgress(data);
        if (data.type === "result") pending.finish(null, data.output);
        if (data.type === "error") pending.finish(new Error(`语音识别失败：${data.error}`));
      };
      this.worker.onerror = (event) => {
        this.pending?.finish(new Error(`语音引擎启动失败：${event.message || "请重新加载扩展"}`));
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const abort = () => {
        this.worker?.terminate();
        this.worker = null;
        finish(new DOMException("已停止", "AbortError"));
      };
      const timer = setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
        finish(new Error("识别耗时过长，请重试或选择较短的视频"));
      }, 10 * 60 * 1000);
      const finish = (error, output) => {
        if (this.pending?.id !== id) return;
        signal.removeEventListener("abort", abort);
        clearTimeout(timer);
        this.pending = null;
        if (error) reject(error); else resolve(output);
      };
      this.pending = { id, finish, onProgress };
      signal.addEventListener("abort", abort, { once: true });
      try { this.worker.postMessage({ id, samples }, [samples.buffer]); }
      catch (error) { finish(error); }
    });
  }

  close() {
    this.pending?.finish(new DOMException("已停止", "AbortError"));
    this.worker?.terminate();
    this.worker = null;
  }
}

export async function decodeAudio(bytes, signal) {
  const context = new AudioContext();
  let decoded;
  try { decoded = await context.decodeAudioData(bytes); }
  catch (error) { throw new Error(`无法解码这条视频的音轨：${error.message}`); }
  finally { await context.close(); }
  if (signal.aborted) throw new DOMException("已停止", "AbortError");
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("这条视频没有可识别的音轨");
  if (decoded.duration > 20 * 60) throw new Error("当前版本支持 20 分钟以内的视频");
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  if (signal.aborted) throw new DOMException("已停止", "AbortError");
  const samples = new Float32Array(rendered.getChannelData(0));
  let energy = 0;
  for (let i = 0; i < samples.length; i += 8) energy += samples[i] * samples[i];
  if (energy / Math.ceil(samples.length / 8) < 1e-9) throw new Error("音轨接近静音，没有可识别的口播");
  return { samples, duration: decoded.duration };
}
