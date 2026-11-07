// Catálogo fixo de telas. O backend só escolhe entre estas; o resto é ignorado.
// Rotas usam apenas ids opacos — nunca nome de paciente ou dado clínico.
import type { Component } from 'vue';
import type { Tela } from '@clinica/contrato-tipos';

export interface DefinicaoTela {
  tela: Tela;
  rota: string;
  componente: () => Promise<Component>;
  /** Módulo exigido (núcleo = undefined). */
  modulo?: 'pacientes' | 'acompanhamento' | 'chat' | 'equipe' | 'agenda' | 'exames';
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
  def('pacientes.lista', '/pacientes', 'equipe', 'FE2', 'pacientes', () => import('@/telas/pacientes/Lista.vue')),
  def('pacientes.novo', '/pacientes/novo', 'equipe', 'FE2', 'pacientes', () => import('@/telas/pacientes/Novo.vue')),
  def('pacientes.detalhe', '/pacientes/:pacienteId', 'equipe', 'FE2', 'pacientes', () => import('@/telas/pacientes/Detalhe.vue')),
  def('acompanhamento.lista', '/acompanhamentos', 'equipe', 'FE2', 'acompanhamento', () => import('@/telas/acompanhamento/Lista.vue')),
  def('acompanhamento.novo', '/acompanhamentos/novo', 'equipe', 'FE2', 'acompanhamento', () => import('@/telas/acompanhamento/Novo.vue')),
  def('acompanhamento.detalhe', '/acompanhamentos/:acompanhamentoId', 'todos', 'FE1', 'acompanhamento', () => import('@/telas/acompanhamento/Detalhe.vue')),
  def('acompanhamento.meus', '/meus', 'paciente', 'FE1', 'acompanhamento', () => import('@/telas/acompanhamento/Meus.vue')),
  def('acompanhamento.protocolos', '/protocolos', 'equipe', 'FE2', 'acompanhamento', () => import('@/telas/acompanhamento/Protocolos.vue')),
  def('acompanhamento.protocolo', '/protocolos/:protocoloId', 'equipe', 'FE2', 'acompanhamento', () => import('@/telas/acompanhamento/Protocolo.vue')),
  def('acompanhamento.checkin', '/checkins/:checkinId', 'todos', 'FE1', 'acompanhamento', () => import('@/telas/acompanhamento/Checkin.vue')),
  def('chat.lista', '/conversas', 'todos', 'FE1', 'chat', () => import('@/telas/chat/Lista.vue')),
  def('chat.conversa', '/conversas/:conversaId', 'todos', 'FE1', 'chat', () => import('@/telas/chat/Conversa.vue')),
  def('equipe.lista', '/equipe', 'gestor', 'FE2', 'equipe', () => import('@/telas/equipe/Lista.vue')),
  def('agenda.lista', '/agenda', 'equipe', 'F4', 'agenda', () => import('@/telas/agenda/Lista.vue')),
  def('agenda.novo', '/agenda/novo', 'equipe', 'F4', 'agenda', () => import('@/telas/agenda/Novo.vue')),
  def('agenda.servicos', '/agenda/servicos', 'equipe', 'F4', 'agenda', () => import('@/telas/agenda/Servicos.vue')),
  def('agenda.grade', '/agenda/grade', 'equipe', 'F4', 'agenda', () => import('@/telas/agenda/Grade.vue')),
  def('agenda.meus', '/agenda/minhas', 'paciente', 'F4', 'agenda', () => import('@/telas/agenda/Meus.vue')),
  def('agenda.marcar', '/agenda/marcar', 'paciente', 'F4', 'agenda', () => import('@/telas/agenda/Marcar.vue')),
  def('agenda.detalhe', '/agenda/:agendamentoId', 'todos', 'F4', 'agenda', () => import('@/telas/agenda/Detalhe.vue')),
  def('exames.lista', '/exames', 'equipe', 'F5', 'exames', () => import('@/telas/exames/Lista.vue')),
  def('exames.novo', '/exames/novo', 'equipe', 'F5', 'exames', () => import('@/telas/exames/Novo.vue')),
  def('exames.meus', '/exames/meus', 'paciente', 'F5', 'exames', () => import('@/telas/exames/Meus.vue')),
  def('exames.enviar', '/exames/enviar', 'todos', 'F5', 'exames', () => import('@/telas/exames/Enviar.vue')),
  def('exames.pedido', '/exames/pedidos/:pedidoId', 'todos', 'F5', 'exames', () => import('@/telas/exames/Pedido.vue')),
  def('exames.resultado', '/exames/resultados/:resultadoId', 'todos', 'F5', 'exames', () => import('@/telas/exames/Resultado.vue')),
  def('organizacao.configuracao', '/configuracoes', 'gestor', 'FE2', undefined, () => import('@/telas/organizacao/Configuracao.vue')),
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
  // Atalhos de criação aceitam contexto opcional (paciente, pedido) na query.
  const extras = ({ 'acompanhamento.novo': ['pacienteId'], 'agenda.novo': ['pacienteId'], 'exames.novo': ['pacienteId'], 'exames.enviar': ['pacienteId', 'pedidoId'] } as Record<string, string[]>)[d.tela] ?? [];
  const q = extras.filter((k) => parametros[k]).map((k) => `${k}=${encodeURIComponent(parametros[k])}`).join('&');
  return q ? `${caminho}?${q}` : caminho;
}
