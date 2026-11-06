// Liga o tempo real à sessão: eventos → cache de consultas, contadores e manifesto.
import { watch } from 'vue';
import { useAppStore } from '@/app/store';
import { useSessaoStore } from '@/sessao/store';
import { clienteConsultas } from '@/dados/consultas';
import { api, ok } from '@/api';
import { iniciarTempoReal } from './conexao';
import { invalidacoesPara, type EventoApp } from './invalidacoes';

export const estadoTempoReal = { atual: 'desligado' as string };

export function ligarTempoReal() {
  const app = useAppStore();
  const sessao = useSessaoStore();
  let desligar: (() => void) | null = null;

  const tratar = (e: EventoApp) => {
    if (e.tipo === 'contadores.alterados') { if (sessao.manifesto) sessao.manifesto.contadores = { ...sessao.manifesto.contadores, ...e.dados }; return; }
    if (e.tipo === 'sessao.manifesto.alterado') { void sessao.carregarManifesto().catch(() => undefined); return; }
    if (e.tipo === 'sessao.encerrada') { sessao.encerrar(String(e.dados?.motivo ?? 'SESSAO_REVOGADA')); return; }
    for (const chave of invalidacoesPara(e)) void clienteConsultas.invalidateQueries({ queryKey: chave as unknown[] });
  };
  const atualizarContadores = async () => {
    if (!sessao.logado) return;
    const c = await ok(api().GET('/v1/contadores', {})).catch(() => null);
    if (c && sessao.manifesto) sessao.manifesto.contadores = c;
  };

  watch(() => sessao.logado && sessao.manifesto?.usuario.id, (usuario) => {
    desligar?.(); desligar = null;
    delete document.documentElement.dataset.tempoReal;
    if (!usuario || !app.organizacao || !sessao.manifesto) return;
    const tr = sessao.manifesto.capacidades.tempoReal;
    desligar = iniciarTempoReal({
      urlApi: app.organizacao.urlApi, slug: app.organizacao.slug, modo: tr.modo as 'SSE' | 'POLLING', intervaloPollingSegundos: tr.intervaloPollingSegundos,
      token: () => sessao.token,
      renovar: async () => !!(await sessao.renovar()),
      aoEvento: tratar,
      aoCursorExpirado: () => { void clienteConsultas.invalidateQueries(); void atualizarContadores(); },
      // Estado também no <html data-tempo-real>: diagnóstico em produção e espera determinística nos E2E.
      aoEstado: (s) => { estadoTempoReal.atual = s; document.documentElement.dataset.tempoReal = s; },
    });
  }, { immediate: true });

  // Ao voltar ao app (aba oculta, celular bloqueado), revalida contadores e telas abertas.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sessao.logado) { void atualizarContadores(); void clienteConsultas.invalidateQueries({ refetchType: 'active' }); }
  });
}
