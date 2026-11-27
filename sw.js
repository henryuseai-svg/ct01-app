// Cho app chạy không cần mạng sau lần mở đầu tiên.
// File của app: lấy bản mới khi có mạng, mất mạng thì dùng bản đã lưu.
// Thư viện CDN (đã ghim phiên bản) và phông chữ: dùng bản đã lưu.
const CACHE = 'ct01-v9';
const APP = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg', 'templates/CT01.docx'];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/pizzip@3.1.7/dist/pizzip.min.js',
  'https://cdn.jsdelivr.net/npm/docxtemplater@3.47.4/build/docxtemplater.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/docx-preview@0.3.2/dist/docx-preview.min.js',
  'https://cdn.jsdelivr.net/npm/barcode-detector@2.3.1/dist/iife/pure.js',
  'https://cdn.jsdelivr.net/npm/zxing-wasm@1.3.4/dist/reader/zxing_reader.wasm',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([...APP, ...LIBS])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === location.origin;
  if (sameOrigin) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
