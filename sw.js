/* =========================================================
   Service worker: deixa a Comanda abrir mesmo sem internet
   - Guarda os arquivos do site no aparelho
   - Sempre tenta buscar a versão nova; se não houver internet,
     usa a cópia guardada
   Ao mudar arquivos do site, aumente o número da VERSAO.
   ========================================================= */

const VERSAO = 'comanda-v3';

const ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/theme.css',
  'assets/css/index.css',
  'assets/css/metrics.css',
  'assets/css/billing.css',
  'assets/css/animations.css',
  'assets/js/theme.js',
  'assets/js/utils.js',
  'assets/js/icons.js',
  'assets/js/billing.js',
  'assets/js/storage.js',
  'assets/js/markdown.js',
  'assets/js/excel.js',
  'assets/js/metrics.js',
  'assets/js/obsidian.js',
  'assets/js/ui.js',
  'assets/js/products.js',
  'assets/js/app.js',
  'assets/img/favicon.svg',
  'assets/img/icon-180.png',
  'assets/img/icon-192.png',
  'assets/img/icon-512.png',
  'assets/img/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Só arquivos do próprio site; a API do servidor local nunca vai para o cache
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;

  // Rede primeiro (pega atualizações); sem internet, usa o que está guardado
  event.respondWith(
    fetch(request)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(request, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((guardado) => guardado || caches.match('index.html')))
  );
});
