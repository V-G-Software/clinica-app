// Rotas geradas do catálogo de telas. Guarda: sessão, módulo ativo e público da tela.
// A checagem final é SEMPRE do backend; aqui só evitamos mostrar o que não faz sentido.
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { CATALOGO, type DefinicaoTela } from '@/catalogo/telas';
import { useSessaoStore } from '@/sessao/store';
import { aguardarInicializacao } from '@/app/inicializacao';
import { useAppStore } from '@/app/store';

const telas: RouteRecordRaw[] = CATALOGO.map((d) => ({ path: d.rota, name: d.tela, component: d.componente, meta: { tela: d } }));

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/entrar', name: 'entrar', component: () => import('@/telas/auth/Entrar.vue'), meta: { publica: true } },
    { path: '/convite/:token', name: 'convite', component: () => import('@/telas/convite/Convite.vue'), meta: { publica: true, convite: true } },
    { path: '/bem-vindo', name: 'bem-vindo', component: () => import('@/telas/convite/BemVindo.vue') },
    { path: '/', component: () => import('@/layout/LayoutApp.vue'), children: [
      ...telas,
      { path: '/indisponivel', name: 'indisponivel', component: () => import('@/telas/sistema/Indisponivel.vue') },
      { path: '/:caminho(.*)*', redirect: '/indisponivel' },
    ] },
  ],
  scrollBehavior: (_a, _b, salvo) => salvo ?? { top: 0 },
});

export function telaPermitida(d: DefinicaoTela, s: ReturnType<typeof useSessaoStore>): boolean {
  if (d.modulo && !s.modulos.has(d.modulo)) return false;
  if (d.publico === 'equipe' && s.ehPaciente) return false;
  if (d.publico === 'paciente' && !s.ehPaciente) return false;
  if (d.tela === 'equipe.lista') return s.pode('equipe.membro.gerenciar');
  if (d.tela === 'agenda.novo') return s.pode('agenda.agendamento.criar');
  if (d.tela === 'agenda.marcar') return s.pode('agenda.agendamento.criar');
  if (d.tela === 'agenda.servicos' || d.tela === 'agenda.grade') return s.pode('agenda.configuracao.gerenciar');
  if (d.tela === 'organizacao.configuracao') return s.pode('organizacao.configuracao.editar');
  return true;
}

router.beforeEach(async (para) => {
  await aguardarInicializacao();
  if (useAppStore().estado !== 'pronto') return true; // App.vue mostra a tela de estado (manutenção, erro…)
  const s = useSessaoStore();
  if (para.meta.publica) return para.name === 'entrar' && s.logado ? '/' : true; // convite é aceito mesmo logado
  if (!s.logado) return { path: '/entrar', query: para.fullPath !== '/' ? { voltar: para.fullPath } : {} };
  const d = para.meta.tela as DefinicaoTela | undefined;
  if (d && !telaPermitida(d, s)) return '/indisponivel';
  return true;
});
