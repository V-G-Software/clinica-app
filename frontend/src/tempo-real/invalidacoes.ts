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
    case 'agenda.agendamento.criado':
    case 'agenda.agendamento.atualizado': return [['agendamento', d.agendamentoId], ['agendamentos'], ['agenda-horarios'], ['inicio']];
    case 'exames.pedido.atualizado': return [['exame-pedido', d.pedidoId], ['exames-pedidos'], ['inicio']];
    case 'exames.resultado.atualizado': return [['exame-resultado', d.resultadoId], ['exames-resultados'], ...(d.pedidoId ? [['exame-pedido', d.pedidoId]] : []), ['inicio']];
    case 'documentos.documento.atualizado': return [['documento', d.documentoId], ['documentos'], ['inicio']];
    case 'documentos.assinatura.atualizada': return [['assinatura', d.sessaoId], ['documentos']];
    case 'notificacao.criada': return [['notificacoes']];
    case 'arquivo.processado': return [['arquivo', d.arquivoId]];
    default: return [];
  }
}
