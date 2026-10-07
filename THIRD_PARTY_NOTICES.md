# Third-party runtime components

The browser speech path reuses the locally bundled runtime from the user's TikTok 达人助手 project. It runs audio recognition locally and downloads model data from Hugging Face.

- Transformers.js 3.8.1 — Hugging Face, Apache-2.0. License: `licenses/transformers-LICENSE.txt`. Source: https://github.com/huggingface/transformers.js
- ONNX Runtime Web 1.22.0 development build — Microsoft, MIT. License: `licenses/onnxruntime-LICENSE.txt`. Source: https://github.com/microsoft/onnxruntime
- Whisper base ONNX model — downloaded on first use, https://huggingface.co/onnx-community/whisper-base ; original model and documentation: https://huggingface.co/openai/whisper-base

Runtime JavaScript and WebAssembly are included in this extension; remote executable scripts are not loaded. Model weights are cached by the browser under this extension's origin.
