// Catálogo fixo de telas (6). O backend só escolhe entre estas; o resto é ignorado.
// Rotas usam apenas ids opacos — nunca nome de paciente ou dado clínico.
import type { Component } from 'vue';
import type { Tela } from '@clinica/contrato-tipos';

export interface DefinicaoTela {
  tela: Tela;
  rota: string;
  componente: () => Promise<Component>;
  /** Módulo exigido (núcleo = undefined). */
  modulo?: 'pacientes' | 'acompanhamento' | 'chat' | 'equipe';
  publico: 'todos' | 'equipe' | 'paciente' | 'gestor';
  fase: string;
}

const construcao = () => import('@/telas/comum/EmConstrucao.vue');
const def = (tela: Tela, rota: string, publico: DefinicaoTela['publico'], fase: string, modulo?: DefinicaoTela['modulo'], componente = construcao): DefinicaoTela =>
  ({ tela, rota, componente, modulo, publico, fase });

export const CATALOGO: DefinicaoTela[] = [
  def('inicio', '/', 'todos', 'FE1/FE2', undefined, () => import('@/telas/inicio/Inicio.vue')),
  def('notificacoes', '/notificacoes', 'todos', 'FE1', undefined, () => import('@/telas/notificacoes/Notificacoes.vue')),
  def('perfil', '/perfil', 'todos', 'FE1', undefined, () => import('@/telas/perfil/Perfil.vue')),
  def('pacientes.lista', '/pacientes', 'equipe', 'FE2', 'pacientes'),
  def('pacientes.novo', '/pacientes/novo', 'equipe', 'FE2', 'pacientes'),
  def('pacientes.detalhe', '/pacientes/:pacienteId', 'equipe', 'FE2', 'pacientes'),
  def('acompanhamento.lista', '/acompanhamentos', 'equipe', 'FE2', 'acompanhamento'),
  def('acompanhamento.novo', '/acompanhamentos/novo', 'equipe', 'FE2', 'acompanhamento'),
  def('acompanhamento.detalhe', '/acompanhamentos/:acompanhamentoId', 'todos', 'FE1', 'acompanhamento', () => import('@/telas/acompanhamento/Detalhe.vue')),
  def('acompanhamento.meus', '/meus', 'paciente', 'FE1', 'acompanhamento', () => import('@/telas/acompanhamento/Meus.vue')),
  def('acompanhamento.protocolos', '/protocolos', 'equipe', 'FE2', 'acompanhamento'),
  def('acompanhamento.protocolo', '/protocolos/:protocoloId', 'equipe', 'FE2', 'acompanhamento'),
  def('acompanhamento.checkin', '/checkins/:checkinId', 'todos', 'FE1', 'acompanhamento', () => import('@/telas/acompanhamento/Checkin.vue')),
  def('chat.lista', '/conversas', 'todos', 'FE1', 'chat', () => import('@/telas/chat/Lista.vue')),
  def('chat.conversa', '/conversas/:conversaId', 'todos', 'FE1', 'chat', () => import('@/telas/chat/Conversa.vue')),
  def('equipe.lista', '/equipe', 'gestor', 'FE2', 'equipe'),
  def('organizacao.configuracao', '/configuracoes', 'gestor', 'FE2'),
];
export const telaPorNome = new Map(CATALOGO.map((d) => [d.tela as string, d]));

/** Monta o caminho de uma tela com parâmetros (ids opacos). Devolve null para tela desconhecida. */
export function caminhoDe(tela: string, parametros: Record<string, string> = {}): string | null {
  const d = telaPorNome.get(tela);
  if (!d) return null;
  let faltou = false;
  const caminho = d.rota.replace(/:(\w+)/g, (_, p) => {
    if (!parametros[p]) faltou = true;
    return encodeURIComponent(parametros[p] ?? '');
  });
  if (faltou) return null;
  if (d.tela === 'acompanhamento.novo' && parametros.pacienteId) return `${caminho}?pacienteId=${encodeURIComponent(parametros.pacienteId)}`;
  return caminho;
}
