/// <reference lib="webworker" />
// Service worker: só o "shell" do app vai para o cache. Respostas da API NUNCA são cacheadas
// (têm dado pessoal e dependem de token). Push e clique em notificação (8.2) também ficam aqui.
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__mock/, /^\/o\//, /^\/diretorio/, /^\/manifest\.webmanifest/] }));

self.addEventListener('message', (e) => { if (e.data?.tipo === 'ATIVAR') void self.skipWaiting(); });

interface PayloadPush { notificacaoId: string; titulo: string; texto: string; tag?: string; destino?: { tela: string; parametros?: Record<string, string> } | null }

self.addEventListener('push', (e) => {
  let p: PayloadPush | null = null;
  try { p = e.data?.json() as PayloadPush; } catch { /* payload inválido: ignora */ }
  if (!p) return;
  e.waitUntil(self.registration.showNotification(p.titulo, { body: p.texto, tag: p.tag, data: { destino: p.destino ?? null } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = (e.notification.data?.destino ?? null) as PayloadPush['destino'];
  // O app traduz `destino` pelo catálogo de telas; o SW só repassa via query.
  const url = destino ? `/?destino=${encodeURIComponent(JSON.stringify(destino))}` : '/';
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = janelas[0] as WindowClient | undefined;
    if (aberta) { await aberta.focus(); aberta.postMessage({ tipo: 'NAVEGAR', destino }); return; }
    await self.clients.openWindow(url);
  })());
});
