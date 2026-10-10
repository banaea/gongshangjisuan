// OCR Worker（纯静态提速方案 B）：每个 worker 独立加载 PaddleOCR 引擎，
// 多 worker = 多核并行识别。主线程通过 postMessage 分发图片，worker 返回 predict 结果。
// 使用方式：new Worker(new URL('./worker.js', location.href), { type: 'module' })
// 模型复用：主线程传入本地模型 tar 绝对 URL（modelUrls），worker 拦截 tar fetch
// 请求转到本地同源 URL（消除 3 个 worker 各自访问百度 CDN 的重复跨网下载）；
// create 保持库默认参数（保证识别行为与主线程引擎一致）。
let engine = null;

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init') {
      // 主线程传入 SDK 绝对 URL 与 wasm 目录绝对 URL（worker 内相对路径基于 worker 自身，必须用绝对 URL）
      const { sdkUrl, wasmPaths, modelUrls } = msg;
      // 拦截 tar 模型请求：CDN URL → 本地同源 URL（HTTP 缓存可复用，不再跨网下载）；
      // 本地缺失/失败时自动回退原 CDN URL，保证引擎总能加载
      if (modelUrls && modelUrls.det && modelUrls.rec) {
        const origFetch = self.fetch.bind(self);
        self.fetch = (url, opts) => {
          const u = typeof url === 'string' ? url : (url && url.url) || '';
          if (u.includes('onnx_infer.tar')) {
            const local = u.includes('PP-OCRv6_small_det') ? modelUrls.det
              : (u.includes('PP-OCRv6_small_rec') ? modelUrls.rec : null);
            if (local) {
              return origFetch(local, opts).then(r => (r && r.ok) ? r : origFetch(url, opts));
            }
          }
          return origFetch(url, opts);
        };
      }
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
