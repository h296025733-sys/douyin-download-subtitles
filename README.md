# 抖音下载与口播字幕

**从当前视频读取素材和平台字幕，预览后导出视频或带时间戳的 SRT。**

整理口播参考时，我需要保留字幕和时间轴，方便回头核对某句话在哪个位置。这个扩展把视频保存与字幕预览放在同一个侧边栏，优先使用平台已经提供的字幕。

## 页面切换后，字幕仍要属于当前视频

页面桥接脚本捕获视频信息，[capture-core.js](capture-core.js) 整理捕获结果，[subtitle-core.js](subtitle-core.js) 解析字幕与时间轴，[sidepanel.js](sidepanel.js) 管理预览与导出。页面事件和当前视频绑定参与更新，减少沿用上一条视频内容的风险。

字幕解析与 SRT 输出保留独立测试，包含字幕绑定和导出后的往返解析。浏览器语音识别作为可选路径保留，默认入口不会自动下载模型；本地 Transformers.js、ONNX Runtime 资源的归属见 [第三方说明](THIRD_PARTY_NOTICES.md)。

## 安装与检查

在 `chrome://extensions/` 打开开发者模式，加载本仓库根目录，再刷新抖音页面。

```powershell
node --test tests/*.test.js
```

`manifest.json` 描述扩展权限，`capture-core.js` 负责捕获，`subtitle-core.js` 负责字幕，`sidepanel.js` 负责侧边栏。真实页面的 DOM、字幕和视频链接会随平台更新，需要在自己的账号环境里确认可用范围。第三方运行库归属见 `THIRD_PARTY_NOTICES.md`。

## 本次公开整理的检查

见 [检查记录](docs/verification.md)，其中区分源码与语法检查、隔离测试和未执行的真实环境路径。
