// OCR Worker（纯静态提速方案 B）：每个 worker 独立加载 PaddleOCR 引擎，
// 多 worker = 多核并行识别。主线程通过 postMessage 分发图片，worker 返回 predict 结果。
// 使用方式：new Worker(new URL('./worker.js', location.href), { type: 'module' })
let engine = null;

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init') {
      // 主线程传入 SDK 绝对 URL 与 wasm 目录绝对 URL（worker 内相对路径基于 worker 自身，必须用绝对 URL）
      const { sdkUrl, wasmPaths } = msg;
      const { PaddleOCR } = await import(sdkUrl);
      engine = await PaddleOCR.create({
        lang: 'ch',
        ocrVersion: 'PP-OCRv6',
        ortOptions: {
          backend: 'wasm',
          wasmPaths,
          numThreads: 1,
          simd: true
        }
      });
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'predict') {
      const opts = msg.opts || {};
      const results = await engine.predict(msg.blob, opts);
      // 只回传结果（不传原 blob，减少克隆开销）
      self.postMessage({ type: 'result', id: msg.id, results });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String((err && err.message) || err) });
  }
};
