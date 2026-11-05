// Web Push (8.2 / 11.2): permissão só depois de um gesto; no iPhone, só com o app instalado.
import { api, ok } from '@/api';

export type EstadoPush = 'indisponivel' | 'precisa-instalar' | 'negado' | 'ativo' | 'inativo';
const CHAVE = (usuarioId: string) => `push:${usuarioId}`;

export const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const ehIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function estadoPush(usuarioId: string, modo: string): Promise<EstadoPush> {
  if (modo !== 'WEB_PUSH') return 'indisponivel';
  if (ehIos() && !instalado()) return 'precisa-instalar';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'indisponivel';
  if (Notification.permission === 'denied') return 'negado';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'indisponivel'; // em desenvolvimento o service worker fica desligado
  const sub = await reg.pushManager.getSubscription();
  return sub && localStorage.getItem(CHAVE(usuarioId)) ? 'ativo' : 'inativo';
}

function chaveVapid(base64Url: string) {
  const b64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const nomeDoAparelho = () => {
  const ua = navigator.userAgent;
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Navegador';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return nav ? `${so} (${nav})` : so;
};

/** Chame somente a partir de um clique do usuário. */
export async function ativarPush(usuarioId: string, chavePublicaVapid: string): Promise<EstadoPush> {
  if ((await Notification.requestPermission()) !== 'granted') return 'negado';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapid(chavePublicaVapid) }));
  const r = await ok(api().POST('/v1/notificacoes/push/inscricoes', {
    params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    body: { inscricao: sub.toJSON() as never, dispositivo: nomeDoAparelho() },
  }));
  localStorage.setItem(CHAVE(usuarioId), r.id);
  return 'ativo';
}
export async function desativarPush(usuarioId: string) {
  const id = localStorage.getItem(CHAVE(usuarioId));
  if (id) await ok(api().DELETE('/v1/notificacoes/push/inscricoes/{inscricaoId}', { params: { path: { inscricaoId: id } } })).catch(() => undefined);
  localStorage.removeItem(CHAVE(usuarioId));
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  await sub?.unsubscribe();
}
