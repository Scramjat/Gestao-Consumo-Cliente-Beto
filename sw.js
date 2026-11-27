/* =========================================================
   A versão anterior guardava o site no aparelho para abrir sem
   internet. Agora o sistema é só online: este arquivo apaga
   aquelas cópias e se desliga nos aparelhos que ainda o têm.
   ========================================================= */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('comanda-')).map((n) => caches.delete(n))))
      .then(() => self.registration.unregister())
  );
});
