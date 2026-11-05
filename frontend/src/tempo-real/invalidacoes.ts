// Mapa evento → consultas a invalidar (9.3). O evento leva só ids; o conteúdo vem da REST.
// Tipo desconhecido não invalida nada (compatível para frente).
export type ChaveConsulta = readonly unknown[];
export interface EventoApp { id: string; tipo: string; ocorridoEm: string; dados: Record<string, any> }

export function invalidacoesPara(e: EventoApp): ChaveConsulta[] {
  const d = e.dados ?? {};
  switch (e.tipo) {
    case 'chat.mensagem.criada': return [['mensagens', d.conversaId], ['conversa', d.conversaId], ['conversas'], ['inicio']];
    case 'chat.conversa.atualizada': return [['conversa', d.conversaId], ['conversas'], ['inicio']];
    case 'acompanhamento.checkin.disponivel':
    case 'acompanhamento.checkin.respondido': return [['checkin', d.checkinId], ['checkins'], ['acompanhamento', d.acompanhamentoId], ['acompanhamentos'], ['inicio']];
    case 'acompanhamento.alerta.criado': return [['alertas'], ['acompanhamento', d.acompanhamentoId], ['acompanhamentos'], ['inicio']];
    case 'acompanhamento.alerta.resolvido': return [['alertas'], ['acompanhamentos'], ['inicio']];
    case 'acompanhamento.acompanhamento.atualizado': return [['acompanhamento', d.acompanhamentoId], ['acompanhamentos'], ['checkins'], ['inicio']];
    case 'notificacao.criada': return [['notificacoes']];
    case 'arquivo.processado': return [['arquivo', d.arquivoId]];
    default: return [];
  }
}
