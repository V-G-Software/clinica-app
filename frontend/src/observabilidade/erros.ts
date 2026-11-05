// Registro de erros com adaptador neutro ([DECISÃO 4] do prompt: Sentry ou similar ainda não escolhido).
// Sem VITE_ERROS_URL nada sai do aparelho; com ela, um evento LIMPO vai por sendBeacon.
// Contexto enviado: rota como PADRÃO (/pacientes/:pacienteId), código e requestId do erro, versão,
// organização. Nunca corpo de requisição/resposta, nome, texto de mensagem ou query string.
import type { App } from 'vue';
import type { Router } from 'vue-router';
import { ErroApi } from '@/api/erros';
import { limpar, limparTexto } from './limpeza';

export interface EventoErro {
  mensagem: string; tipo: string; rota: string | null; codigo?: string; status?: number; requestId?: string | null;
  versaoApp: string; organizacao: string | null; pilha?: string; ocorridoEm: string; extra?: unknown;
}
let roteador: Router | null = null;
let organizacao: () => string | null = () => null;
const vistos = new Map<string, number>();

export function montarEvento(erro: unknown, extra?: Record<string, unknown>): EventoErro {
  const e = erro instanceof Error ? erro : new Error(typeof erro === 'string' ? erro : 'erro não identificado');
  const rota = roteador?.currentRoute.value.matched.at(-1)?.path ?? null;
  return {
    mensagem: limparTexto(e.message).slice(0, 500), tipo: e.name, rota,
    ...(e instanceof ErroApi ? { codigo: e.codigo, status: e.status, requestId: e.requestId } : {}),
    versaoApp: __VERSAO_APP__, organizacao: organizacao(),
    pilha: e.stack ? limparTexto(e.stack).split('\n').slice(0, 12).join('\n') : undefined,
    ocorridoEm: new Date().toISOString(), extra: extra ? limpar(extra) : undefined,
  };
}

export function registrarErro(erro: unknown, extra?: Record<string, unknown>) {
  // 4xx esperados (validação, conflito, permissão) são fluxo normal, não erro do app.
  if (erro instanceof ErroApi && erro.status >= 400 && erro.status < 500 && erro.codigo !== 'DESCONHECIDO') return;
  const ev = montarEvento(erro, extra);
  const chave = `${ev.tipo}|${ev.mensagem}|${ev.rota}`;
  const agora = Date.now();
  if ((vistos.get(chave) ?? 0) > agora - 60_000) return; // no máximo 1 por minuto por erro
  vistos.set(chave, agora);
  const destino = import.meta.env.VITE_ERROS_URL;
  if (destino) navigator.sendBeacon?.(destino, new Blob([JSON.stringify(ev)], { type: 'application/json' }));
  else if (import.meta.env.DEV) console.error('[erro]', ev);
}

export function instalarCapturaDeErros(app: App, router: Router, slugAtual: () => string | null) {
  roteador = router;
  organizacao = slugAtual;
  app.config.errorHandler = (e, _instancia, info) => registrarErro(e, { info });
  window.addEventListener('error', (e) => registrarErro(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => registrarErro(e.reason));
}
