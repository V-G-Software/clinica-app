// Registra o service worker só no build de produção (em dev ele atrapalharia o HMR).
export function registrarServiceWorker() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
