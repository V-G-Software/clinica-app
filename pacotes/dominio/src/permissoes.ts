export type Perfil = 'GESTOR' | 'PROFISSIONAL' | 'SECRETARIA' | 'PACIENTE';
export interface ModuloAtivo { id: string; versao: string; config: Record<string, any> }
export const PRIORIDADE_PERFIL: Perfil[] = ['PROFISSIONAL', 'SECRETARIA', 'GESTOR', 'PACIENTE'];
export const perfilPadrao = (perfis: string[]): Perfil => PRIORIDADE_PERFIL.find((p) => perfis.includes(p))!;
export const ehEquipe = (perfis: string[]) => perfis.some((p) => p !== 'PACIENTE');

export const TODAS_PERMISSOES = [
  'pacientes.paciente.ler', 'pacientes.paciente.criar', 'pacientes.paciente.editar', 'pacientes.paciente.convidar',
  'acompanhamento.protocolo.ler', 'acompanhamento.protocolo.gerenciar', 'acompanhamento.acompanhamento.ler',
  'acompanhamento.acompanhamento.criar', 'acompanhamento.acompanhamento.encerrar', 'acompanhamento.checkin.ler',
  'acompanhamento.checkin.responder', 'acompanhamento.alerta.ler', 'acompanhamento.alerta.resolver',
  'chat.conversa.ler', 'chat.conversa.criar', 'chat.conversa.gerenciar', 'chat.mensagem.enviar',
  'equipe.membro.ler', 'equipe.membro.gerenciar', 'organizacao.configuracao.editar',
  'agenda.agendamento.ler', 'agenda.agendamento.criar', 'agenda.agendamento.gerenciar', 'agenda.configuracao.gerenciar',
  'exames.exame.ler', 'exames.pedido.criar', 'exames.resultado.enviar', 'exames.resultado.revisar',
  'documentos.documento.ler', 'documentos.documento.emitir',
] as const;

/** Tabela da seção 9.6. [DECISÃO 3]: secretária vê check-ins e alertas por padrão. */
export const PERMISSOES_POR_PERFIL: Record<Perfil, readonly string[]> = {
  GESTOR: TODAS_PERMISSOES.filter((p) => p !== 'acompanhamento.checkin.responder'),
  PROFISSIONAL: TODAS_PERMISSOES.filter((p) => !['acompanhamento.checkin.responder', 'equipe.membro.gerenciar', 'organizacao.configuracao.editar', 'agenda.configuracao.gerenciar'].includes(p)),
  SECRETARIA: [
    'pacientes.paciente.ler', 'pacientes.paciente.criar', 'pacientes.paciente.editar', 'pacientes.paciente.convidar',
    'acompanhamento.protocolo.ler', 'acompanhamento.acompanhamento.ler', 'acompanhamento.acompanhamento.criar',
    'acompanhamento.checkin.ler', 'acompanhamento.alerta.ler', 'chat.conversa.ler', 'chat.conversa.criar',
    'chat.conversa.gerenciar', 'chat.mensagem.enviar', 'equipe.membro.ler',
    'agenda.agendamento.ler', 'agenda.agendamento.criar', 'agenda.agendamento.gerenciar', 'agenda.configuracao.gerenciar',
    // Pedir e revisar exame é ato do profissional (ADR-0017); a secretaria vê e anexa resultados.
    'exames.exame.ler', 'exames.resultado.enviar',
  ],
  PACIENTE: [
    'pacientes.paciente.ler', 'acompanhamento.acompanhamento.ler', 'acompanhamento.checkin.ler',
    'acompanhamento.checkin.responder', 'chat.conversa.ler', 'chat.mensagem.enviar', 'agenda.agendamento.ler',
    'exames.exame.ler', 'documentos.documento.ler',
  ],
};
export const temModulo = (modulos: ModuloAtivo[], id: string) => modulos.some((m) => m.id === id);
export const configModulo = (modulos: ModuloAtivo[], id: string) => modulos.find((m) => m.id === id)?.config ?? {};

/** Permissões efetivas: tabela do perfil, filtrada pelos módulos ativos (núcleo: organizacao). */
export function permissoesDe(modulos: ModuloAtivo[], perfil: Perfil): string[] {
  const base = [...PERMISSOES_POR_PERFIL[perfil]];
  if (perfil === 'PACIENTE' && configModulo(modulos, 'chat').pacientePodeIniciar) base.push('chat.conversa.criar');
  if (perfil === 'PACIENTE' && configModulo(modulos, 'agenda').autoagendamento) base.push('agenda.agendamento.criar');
  // Exames: o paciente envia resultados, salvo se a organização desligar (padrão: ligado).
  if (perfil === 'PACIENTE' && configModulo(modulos, 'exames').pacienteEnviaResultados !== false) base.push('exames.resultado.enviar');
  return base.filter((p) => { const m = p.split('.')[0]; return m === 'organizacao' || temModulo(modulos, m); });
}
